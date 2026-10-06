import { githubMediaPull, githubMediaSource } from '@jetty/shared/github-media'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '@jetty/shared/wire'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { open, rename, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'

import { ghToken, githubRenderedGet } from './pull-requests'

const TYPES = {
  png: { mimeType: 'image/png', maxBytes: MAX_IMAGE_BYTES },
  jpg: { mimeType: 'image/jpeg', maxBytes: MAX_IMAGE_BYTES },
  gif: { mimeType: 'image/gif', maxBytes: MAX_IMAGE_BYTES },
  webp: { mimeType: 'image/webp', maxBytes: MAX_IMAGE_BYTES },
  svg: { mimeType: 'image/svg+xml', maxBytes: MAX_IMAGE_BYTES },
  mp4: { mimeType: 'video/mp4', maxBytes: MAX_VIDEO_BYTES },
  mov: { mimeType: 'video/quicktime', maxBytes: MAX_VIDEO_BYTES },
  webm: { mimeType: 'video/webm', maxBytes: MAX_VIDEO_BYTES },
}

type Ext = keyof typeof TYPES

const CACHE_BYTES = 1024 ** 3
const SNIFF_BYTES = 1024
const MAX_HOPS = 3

// GitHub's signed asset CDN, where attachment URLs redirect to. Never sent the token.
const cdnHost =
  /^(?:github-production-user-asset-[a-z0-9]+\.s3\.amazonaws\.com|(?:private-)?user-images\.githubusercontent\.com|objects\.githubusercontent\.com)$/

const svgStart = /^\s*(?:<\?xml[^>]*>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>]/i
const attachmentId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
// The same cap as the other GitHub list reads.
const RENDERED_PAGES = 30

export class GithubMediaError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // An HTML sign-in page or a hidden attachment can still be loaded from rendered HTML.
    readonly fallback = false
  ) {
    super(message)
  }
}

export type GithubMedia = { path: string; mimeType: string } | GithubMediaError

function ascii(bytes: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...bytes.subarray(from, to))
}

// Trusts the bytes, and only when they agree with the type GitHub declared.
function sniff(head: Uint8Array, declared: string): Ext | null {
  let ext: Ext | null = null
  if (head[0] === 0x89 && ascii(head, 1, 4) === 'PNG') ext = 'png'
  else if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) ext = 'jpg'
  else if (ascii(head, 0, 4) === 'GIF8') ext = 'gif'
  else if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') ext = 'webp'
  else if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    ext = 'webm'
  else if (ascii(head, 4, 8) === 'ftyp') ext = ascii(head, 8, 12) === 'qt  ' ? 'mov' : 'mp4'
  else if (declared === 'image/svg+xml' && svgStart.test(new TextDecoder().decode(head)))
    ext = 'svg'
  if (!ext) return null
  // MP4 and QuickTime share a container; GitHub labels a recording either way.
  if ((ext === 'mp4' || ext === 'mov') && declared === 'video/quicktime') return 'mov'
  if ((ext === 'mp4' || ext === 'mov') && declared === 'video/mp4') return 'mp4'
  return declared === TYPES[ext].mimeType || declared === 'application/octet-stream' ? ext : null
}

function nextHop(location: string, from: URL): URL | null {
  let next: URL
  try {
    next = new URL(location, from)
  } catch {
    return null
  }
  if (next.protocol !== 'https:' || next.username || next.password || next.port) return null
  return cdnHost.test(next.hostname) ? next : githubMediaSource(next.href)
}

function mediaType(response: Response) {
  return (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
}

function textual(type: string) {
  return type.startsWith('text/') || type === 'application/xhtml+xml'
}

function logMiss(response: Response, type: string, url: URL) {
  // Path only: a signed URL's query is the jwt.
  console.warn(
    `[github-media] ${response.status} ${type || 'unknown'} ${url.hostname}${url.pathname}`
  )
}

function looksLikeHtml(head: Uint8Array) {
  const text = new TextDecoder().decode(head.subarray(0, 64)).trimStart().toLowerCase()
  return text.startsWith('<!doctype html') || text.startsWith('<html')
}

function bodyHtml(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const html = (value as { body_html?: unknown }).body_html
  return typeof html === 'string' ? html : ''
}

// The uuid is in the filename. A jwt in the query can repeat it and must not count.
function signedUrl(html: string, id: string): URL | null {
  const pattern = /https:\/\/private-user-images\.githubusercontent\.com\/[^\s"'<>]+/gi
  for (const match of html.matchAll(pattern)) {
    let url: URL
    try {
      url = new URL(match[0].replaceAll('&amp;', '&'))
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) continue
    if (url.hostname !== 'private-user-images.githubusercontent.com') continue
    let file = url.pathname.split('/').pop() ?? ''
    try {
      file = decodeURIComponent(file)
    } catch {
      // The raw filename is still comparable.
    }
    if (file.toLowerCase().includes(id)) return url
  }
  return null
}

async function findInPages(path: string, id: string): Promise<URL | null> {
  for (let page = 1; page <= RENDERED_PAGES; page++) {
    const result = await githubRenderedGet(`${path}?per_page=100&page=${page}`)
    if (!Array.isArray(result)) return null
    for (const item of result) {
      const found = signedUrl(bodyHtml(item), id)
      if (found) return found
    }
    if (result.length < 100) return null
  }
  return null
}

async function renderedAttachment(pull: string, id: string): Promise<URL | null> {
  const [owner, repo, number] = pull.split('/')
  const base = `repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}`
  const issue = signedUrl(bodyHtml(await githubRenderedGet(`${base}/issues/${number}`)), id)
  if (issue) return issue
  for (const path of [
    `${base}/issues/${number}/comments`,
    `${base}/pulls/${number}/comments`,
    `${base}/pulls/${number}/reviews`,
  ]) {
    const found = await findInPages(path, id)
    if (found) return found
  }
  return null
}

// Proxies GitHub attachments with the gh login, cached on disk because attachment URLs never change.
export function createGithubMedia(home: string) {
  const dir = join(home, 'github-media')
  mkdirSync(dir, { recursive: true })
  const entries = new Map<string, Ext>()
  for (const name of readdirSync(dir)) {
    const [key, ext] = name.split('.')
    if (name.startsWith('.tmp-')) rmSync(join(dir, name), { force: true })
    else if (key && ext && ext in TYPES) entries.set(key, ext as Ext)
  }
  const inFlight = new Map<string, Promise<GithubMedia>>()

  function entryPath(key: string, ext: Ext) {
    return join(dir, `${key}.${ext}`)
  }

  async function evict() {
    const files = await Promise.all(
      [...entries].map(async ([key, ext]) => {
        const info = await stat(entryPath(key, ext)).catch(() => null)
        return { key, ext, size: info?.size ?? 0, used: info?.mtimeMs ?? 0 }
      })
    )
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((left, right) => left.used - right.used)) {
      if (total <= CACHE_BYTES) return
      entries.delete(file.key)
      await rm(entryPath(file.key, file.ext), { force: true })
      total -= file.size
    }
  }

  async function save(response: Response, key: string): Promise<GithubMedia> {
    const declared = (response.headers.get('content-type') ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase()
    if (Number(response.headers.get('content-length')) > MAX_VIDEO_BYTES)
      throw new GithubMediaError(413, 'Attachment is too large')
    const temp = join(dir, `.tmp-${randomUUID()}`)
    const file = await open(temp, 'w')
    try {
      let head = new Uint8Array()
      let ext: Ext | null = null
      let size = 0
      for await (const chunk of response.body!) {
        if (!ext && head.length < SNIFF_BYTES) head = Buffer.concat([head, chunk])
        if (!ext && head.length >= SNIFF_BYTES) ext = sniff(head, declared)
        if (!ext && head.length >= SNIFF_BYTES)
          throw new GithubMediaError(
            415,
            'Attachment is not a supported image or video',
            looksLikeHtml(head)
          )
        size += chunk.byteLength
        if (size > (ext ? TYPES[ext].maxBytes : MAX_VIDEO_BYTES))
          throw new GithubMediaError(413, 'Attachment is too large')
        await file.write(chunk)
      }
      ext ??= sniff(head, declared)
      if (!ext)
        throw new GithubMediaError(
          415,
          'Attachment is not a supported image or video',
          looksLikeHtml(head)
        )
      await file.close()
      const path = entryPath(key, ext)
      await rename(temp, path)
      entries.set(key, ext)
      // In the background: an unhandled rejection here would take the whole server down.
      void evict().catch((error: unknown) => console.warn(`[github-media] evict ${String(error)}`))
      return { path, mimeType: TYPES[ext].mimeType }
    } finally {
      await file.close().catch(() => {})
      await rm(temp, { force: true })
    }
  }

  async function transfer(source: URL, key: string): Promise<GithubMedia> {
    let url = source
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const headers: Record<string, string> = { 'User-Agent': 'jetty' }
      // github.com takes the gh login as `token`, like raw.githubusercontent.com. The signed CDN
      // hosts never get it: the redirect carries its own signature.
      const auth = url.hostname === 'github.com' ? await ghToken() : null
      if (auth) headers.Authorization = `token ${auth}`
      const response = await fetch(url, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        const next = nextHop(response.headers.get('location') ?? '', url)
        if (!next) throw new GithubMediaError(502, 'GitHub redirected off its attachment hosts')
        url = next
        continue
      }
      const type = mediaType(response)
      // A SAML org's github.com answers the attachment URL with an HTML sign-in page, often 200.
      if (!response.ok || textual(type)) {
        logMiss(response, type, url)
        await response.body?.cancel()
        const hidden = response.status === 401 || response.status === 403 || response.status === 404
        throw new GithubMediaError(
          hidden ? 404 : response.ok ? 415 : 502,
          response.ok
            ? 'Attachment is not a supported image or video'
            : 'GitHub attachment is unavailable',
          hidden || textual(type)
        )
      }
      try {
        return await save(response, key)
      } catch (error) {
        if (error instanceof GithubMediaError && error.status !== 413) logMiss(response, type, url)
        throw error
      }
    }
    throw new GithubMediaError(502, 'GitHub redirected too many times')
  }

  // The direct attachment fetch works for a normal repo. When it comes back as HTML, or as
  // 401/403/404, a pull request's rendered HTML names the same uuid on the signed CDN.
  async function download(source: URL, key: string, pull: string | null): Promise<GithubMedia> {
    try {
      return await transfer(source, key)
    } catch (error) {
      if (!(error instanceof GithubMediaError) || !error.fallback) throw error
      const id = attachmentId.exec(source.pathname)?.[0]?.toLowerCase()
      if (!pull || !id) throw error
      let signed: URL | null
      try {
        signed = await renderedAttachment(pull, id)
      } catch (cause) {
        const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : ''
        console.warn(`[github-media] fallback ${pull} ${id} missing${detail}`)
        throw error
      }
      console.warn(`[github-media] fallback ${pull} ${id} ${signed ? 'found' : 'missing'}`)
      if (!signed) throw error
      return await transfer(signed, key)
    }
  }

  async function cached(key: string): Promise<GithubMedia | null> {
    const ext = entries.get(key)
    if (!ext) return null
    const path = entryPath(key, ext)
    const now = new Date()
    if (
      !(await utimes(path, now, now).then(
        () => true,
        () => false
      ))
    ) {
      entries.delete(key)
      return null
    }
    return { path, mimeType: TYPES[ext].mimeType }
  }

  async function resolve(value: string, pull?: string | null): Promise<GithubMedia> {
    const source = githubMediaSource(value)
    if (!source) return new GithubMediaError(400, 'Not a GitHub attachment URL')
    // Signed URLs carry a short-lived token; the file behind them doesn't change, so the cache
    // key is the canonical attachment (the uuid), not the signed CDN URL.
    const key = createHash('sha256').update(`${source.origin}${source.pathname}`).digest('hex')
    const hit = await cached(key)
    if (hit) return hit
    const context = githubMediaPull(pull)
    // The file is cached by uuid. The in-flight entry also carries the pull request, so a chat
    // image that fails does not answer a pull request image that can still fall back.
    const flight = `${key}\0${context ?? ''}`
    let pending = inFlight.get(flight)
    if (!pending) {
      pending = download(source, key, context)
        .catch((error: unknown) =>
          error instanceof GithubMediaError
            ? error
            : new GithubMediaError(502, 'GitHub attachment is unavailable')
        )
        .finally(() => inFlight.delete(flight))
      inFlight.set(flight, pending)
    }
    return pending
  }

  return { resolve }
}

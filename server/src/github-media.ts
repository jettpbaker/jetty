import { githubMediaSource } from '@jetty/shared/github-media'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '@jetty/shared/wire'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { open, rename, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'

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

export class GithubMediaError extends Error {
  constructor(
    readonly status: number,
    message: string
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

async function readGhToken(): Promise<string | null> {
  const gh = Bun.which('gh')
  if (!gh) return null
  try {
    const child = Bun.spawn([gh, 'auth', 'token', '--hostname', 'github.com'], {
      stdout: 'pipe',
      stderr: 'ignore',
      signal: AbortSignal.timeout(3000),
    })
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return code === 0 ? out.trim() || null : null
  } catch {
    return null
  }
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
  let token: { value: Promise<string | null>; at: number } | undefined

  function ghToken() {
    if (!token || Date.now() - token.at > 5 * 60_000)
      token = { value: readGhToken(), at: Date.now() }
    return token.value
  }

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
          throw new GithubMediaError(415, 'Attachment is not a supported image or video')
        size += chunk.byteLength
        if (size > (ext ? TYPES[ext].maxBytes : MAX_VIDEO_BYTES))
          throw new GithubMediaError(413, 'Attachment is too large')
        await file.write(chunk)
      }
      ext ??= sniff(head, declared)
      if (!ext) throw new GithubMediaError(415, 'Attachment is not a supported image or video')
      await file.close()
      const path = entryPath(key, ext)
      await rename(temp, path)
      entries.set(key, ext)
      void evict()
      return { path, mimeType: TYPES[ext].mimeType }
    } finally {
      await file.close().catch(() => {})
      await rm(temp, { force: true })
    }
  }

  async function download(source: URL, key: string): Promise<GithubMedia> {
    let url = source
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const headers: Record<string, string> = { 'User-Agent': 'jetty' }
      const auth = url.hostname === 'github.com' ? await ghToken() : null
      if (auth) headers.Authorization = `Bearer ${auth}`
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
      if (!response.ok) {
        await response.body?.cancel()
        throw new GithubMediaError(
          [401, 403, 404].includes(response.status) ? 404 : 502,
          'GitHub attachment is unavailable'
        )
      }
      return await save(response, key)
    }
    throw new GithubMediaError(502, 'GitHub redirected too many times')
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

  async function resolve(value: string): Promise<GithubMedia> {
    const source = githubMediaSource(value)
    if (!source) return new GithubMediaError(400, 'Not a GitHub attachment URL')
    // Signed URLs carry a short-lived token; the file behind them doesn't change.
    const key = createHash('sha256').update(`${source.origin}${source.pathname}`).digest('hex')
    const hit = await cached(key)
    if (hit) return hit
    let pending = inFlight.get(key)
    if (!pending) {
      pending = download(source, key)
        .catch((error: unknown) =>
          error instanceof GithubMediaError
            ? error
            : new GithubMediaError(502, 'GitHub attachment is unavailable')
        )
        .finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    return pending
  }

  return { resolve }
}

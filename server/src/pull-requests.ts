import type {
  GitHubActivity,
  PullRequestReviewer,
  ReviewerCandidate,
} from '@jetty/shared/pull-request'
import type {
  PullRequestList,
  PullRequestListItem,
  PullRequestListTab,
  PullRequestSnapshot,
} from '@jetty/shared/wire'

import { PullRequestData, rollupChecks } from '@jetty/shared/pull-request'
import { Effect, Schema, Scope, Semaphore } from 'effect'

import type { PullRequestReference } from './pull-request-graphql'
import type { Store } from './store'

import { closestActivity, type Hub } from './hub'
import {
  actorFields,
  connectionField,
  pageFields,
  pullRequestConnections,
  reviewCommentFields,
  canonicalLogin,
  pullRequestChecksFields,
  copilotWriteLogin,
  githubUser as user,
  findPullRequestReferences,
  mapPullRequestGraphql,
  mapPullRequestReferences,
  mapReviewers,
  pullRequestGraphqlFields,
  pullRequestGraphqlQuery,
  pullRequestReferenceFields,
  pullRequestStateFields,
  nodes,
  record,
  referenceKey,
  string,
} from './pull-request-graphql'
import { StoreError } from './store'

export type PullRequestRef = { repo: string; number: number }

export async function githubConnection(): Promise<{
  state: 'connected' | 'signed-out' | 'missing' | 'error'
}> {
  const gh = Bun.which('gh')
  if (!gh) return { state: 'missing' }
  try {
    const child = Bun.spawn([gh, 'auth', 'status'], {
      stdout: 'ignore',
      stderr: 'ignore',
      signal: AbortSignal.timeout(3000),
    })
    const exitCode = await child.exited
    if (child.signalCode) return { state: 'error' }
    return { state: exitCode === 0 ? 'connected' : 'signed-out' }
  } catch {
    return { state: 'error' }
  }
}

export function validRepo(repo: string): boolean {
  const parts = repo.split('/')
  return (
    parts.length === 2 &&
    parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')
  )
}

export function validPullRequestRef(ref: PullRequestRef): boolean {
  return validRepo(ref.repo) && Number.isSafeInteger(ref.number) && ref.number > 0
}

export function validLogin(login: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(login)
}

export function parsePullRequestUrl(value: string): PullRequestRef | null {
  try {
    const trimmed = value.trim().replace(/[)\].,;!?"'`]+$/, '')
    const url = new URL(trimmed.startsWith('github.com/') ? `https://${trimmed}` : trimmed)
    const parts = url.pathname.split('/').filter(Boolean)
    if (url.hostname.toLowerCase() !== 'github.com' || parts.length < 4 || parts[2] !== 'pull')
      return null
    if (!/^[A-Za-z0-9_.-]+$/.test(parts[0] ?? '') || !/^[A-Za-z0-9_.-]+$/.test(parts[1] ?? ''))
      return null
    const number = Number(parts[3])
    return Number.isSafeInteger(number) && number > 0
      ? { repo: `${parts[0]}/${parts[1]}`.toLowerCase(), number }
      : null
  } catch {
    return null
  }
}

export function pullRequestUrls(text: string): PullRequestRef[] {
  const found = new Map<string, PullRequestRef>()
  for (const match of text.matchAll(
    /(?:https?:\/\/)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]+[^\s<>]*/gi
  )) {
    const ref = parsePullRequestUrl(match[0])
    if (ref) found.set(`${ref.repo}#${ref.number}`, ref)
    if (found.size >= 3) break
  }
  return [...found.values()]
}

export type PullRequestLinks = ReturnType<typeof createPullRequestLinks>

export function createPullRequestLinks(
  store: Store,
  hub: Hub,
  pulls: ReturnType<typeof createPullRequests>,
  scope: Scope.Scope
) {
  function linkRef(threadId: string, ref: PullRequestRef) {
    return Effect.gen(function* () {
      const thread = yield* hub.withChromePublication(
        Effect.gen(function* () {
          if (yield* store.hasPullRequestLink(threadId, ref.repo, ref.number))
            return yield* store.requireThread(threadId)
          const thread = yield* store.linkPullRequest(threadId, ref.repo, ref.number)
          hub.pushChrome({ type: 'thread.upserted', thread })
          return thread
        })
      )
      yield* pulls.refreshIfStale(ref, 120_000).pipe(
        Effect.catchCause((cause) => Effect.logWarning(cause)),
        Effect.forkIn(scope)
      )
      return thread
    })
  }

  function resolve(threadId: string, reference: string) {
    return Effect.gen(function* () {
      const thread = yield* store.requireThread(threadId)
      const url = parsePullRequestUrl(reference.trim())
      if (url) return url
      const project = yield* store.getProject(thread.projectId)
      const remote = project ? yield* Effect.promise(() => projectRemote(project.path)) : null
      return yield* resolvePullRequestReference(reference, remote)
    })
  }

  return {
    resolve,
    link: (threadId: string, reference: string) =>
      Effect.gen(function* () {
        const ref = yield* resolve(threadId, reference)
        return { ref, thread: yield* linkRef(threadId, ref) }
      }),
    linkFound: (threadId: string, text: string) =>
      Effect.forEach(pullRequestUrls(text), (ref) => linkRef(threadId, ref), { discard: true }),
  }
}

export async function projectRemote(path: string): Promise<string | null> {
  try {
    const child = Bun.spawn(['git', 'remote', 'get-url', 'origin'], {
      cwd: path,
      stdout: 'pipe',
      stderr: 'ignore',
      signal: AbortSignal.timeout(3000),
    })
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    if (code !== 0) return null
    const value = output.trim()
    const match = value.match(
      /(?:github\.com[:/])([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i
    )
    return match ? `${match[1]}/${match[2]}`.toLowerCase() : null
  } catch {
    return null
  }
}

export function resolvePullRequestReference(
  value: string,
  remote: string | null
): Effect.Effect<PullRequestRef, StoreError> {
  const url = parsePullRequestUrl(value.trim())
  if (url) return Effect.succeed(url)
  const number = Number(value.trim().replace(/^#/, ''))
  if (remote && Number.isSafeInteger(number) && number > 0)
    return Effect.succeed({ repo: remote, number })
  return Effect.fail(
    new StoreError(
      'invalid_params',
      'Use a GitHub pull request URL or a number in a project with a GitHub origin'
    )
  )
}

class GhFailure extends Error {
  constructor(
    readonly kind: 'unavailable' | 'not_found' | 'rate_limited',
    message: string,
    readonly status?: number,
    // GitHub timed out or refused the query's size, so a smaller one may succeed.
    readonly tooLarge = false
  ) {
    super(message)
  }
}

async function readGhToken(): Promise<string | null> {
  const bin = Bun.which('gh')
  if (!bin) return null
  try {
    const child = Bun.spawn([bin, 'auth', 'token', '--hostname', 'github.com'], {
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

let tokenRead: { value: Promise<string | null>; at: number } | undefined

// The gh login, read every five minutes rather than spawning gh for every call.
export function ghToken() {
  if (!tokenRead || Date.now() - tokenRead.at > 5 * 60_000)
    tokenRead = { value: readGhToken(), at: Date.now() }
  return tokenRead.value
}

const rateHealth = {
  remaining: null as number | null,
  resetAt: null as string | null,
  cost: null as number | null,
  restRemaining: null as number | null,
  restResetAt: null as string | null,
  backoffUntil: null as number | null,
}
let secondaryFailures = 0
const restCache = new Map<string, { etag: string; value: unknown }>()
const apiInFlight = new Map<string, Promise<unknown>>()

export function githubRateLimitHealth(
  cadenceMs: number | null,
  checksCadenceMs: number | null = null
) {
  return {
    ...rateHealth,
    backoffUntil:
      rateHealth.backoffUntil && rateHealth.backoffUntil > Date.now()
        ? rateHealth.backoffUntil
        : null,
    cadenceMs,
    checksCadenceMs,
  }
}

function lowBalance(remaining: number | null, resetAt: string | null) {
  return remaining !== null && remaining < 500 && Date.parse(resetAt ?? '') > Date.now()
}

function cadenceMultiplier() {
  return lowBalance(rateHealth.remaining, rateHealth.resetAt) ||
    lowBalance(rateHealth.restRemaining, rateHealth.restResetAt)
    ? 4
    : 1
}

function backingOff() {
  return (rateHealth.backoffUntil ?? 0) > Date.now()
}

export function observeRateLimit(headers: Headers, body: unknown, status: number, detail = '') {
  const remaining = headers.get('x-ratelimit-remaining')
  const resetAt = Number(headers.get('x-ratelimit-reset')) * 1000 || 0
  if (remaining !== null && headers.get('x-ratelimit-resource') !== 'graphql') {
    rateHealth.restRemaining = Number(remaining)
    rateHealth.restResetAt = resetAt ? new Date(resetAt).toISOString() : null
  }
  const limit = record(record(record(body).data).rateLimit)
  if (limit.remaining !== undefined) {
    rateHealth.remaining = Number(limit.remaining)
    rateHealth.cost = Number(limit.cost)
    rateHealth.resetAt = string(limit.resetAt)
    console.info(
      `[pr-rate] cost=${rateHealth.cost} remaining=${rateHealth.remaining} reset=${rateHealth.resetAt} cadenceMultiplier=${cadenceMultiplier()}`
    )
  }
  const retryAfter = headers.get('retry-after')
  const limited =
    status === 429 ||
    remaining === '0' ||
    ((status === 403 || status === 200) &&
      (Boolean(retryAfter) || /rate limit|abuse detection/i.test(detail)))
  if (!limited) {
    if (status >= 200 && status < 400 && !backingOff()) secondaryFailures = 0
    return
  }
  const until = retryAfter
    ? Number.isFinite(Number(retryAfter))
      ? Date.now() + Number(retryAfter) * 1000
      : Date.parse(retryAfter)
    : remaining === '0'
      ? resetAt
      : Date.now() + Math.min(15 * 60_000, 60_000 * 2 ** secondaryFailures++)
  rateHealth.backoffUntil = Math.max(rateHealth.backoffUntil ?? 0, Date.now() + 1000, until || 0)
  console.warn(
    `[pr-rate] backoff until=${new Date(rateHealth.backoffUntil).toISOString()} status=${status} remaining=${remaining} retry-after=${retryAfter}`
  )
}

function backoffFailure() {
  return new GhFailure(
    'rate_limited',
    `GitHub rate limit reached; retry after ${new Date(rateHealth.backoffUntil!).toISOString()}`
  )
}

export function checkBackoff() {
  if (backingOff()) throw backoffFailure()
}

type ApiRequest = { method: string; path: string; body?: string }
type ApiResponse = { status: number; headers: Headers; text: string; detail: string }

// Points the API at a stand-in (the perf lab's fake GitHub), which is never sent the login.
const apiUrl = process.env.JETTY_GITHUB_API_URL

async function fetchApi(request: ApiRequest, etag?: string, token?: string): Promise<ApiResponse> {
  const response = await fetch(`${apiUrl ?? 'https://api.github.com'}/${request.path}`, {
    method: request.method,
    body: request.body,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Jetty',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
    detail: '',
  }
}

// The same request through gh, when its login can't be read.
async function ghRequest(request: ApiRequest, etag?: string): Promise<ApiResponse> {
  const bin = Bun.which('gh')
  if (!bin) throw new GhFailure('unavailable', 'GitHub CLI is not installed')
  const child = Bun.spawn(
    [
      bin,
      'api',
      '--hostname',
      'github.com',
      '--include',
      '--method',
      request.method,
      request.path,
      ...(etag ? ['-H', `If-None-Match: ${etag}`] : []),
      ...(request.body === undefined ? [] : ['--input', '-']),
    ],
    {
      stdin: request.body === undefined ? 'ignore' : new Blob([request.body]),
      stdout: 'pipe',
      stderr: 'pipe',
      signal: AbortSignal.timeout(20_000),
    }
  )
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const split = out.search(/\r?\n\r?\n/)
  const headerText = split >= 0 ? out.slice(0, split) : ''
  const status = Number(headerText.match(/^HTTP\/\S+\s+(\d+)/)?.[1]) || (code === 0 ? 200 : 0)
  if (!status)
    throw new GhFailure(
      'unavailable',
      err.trim() || 'GitHub API is unavailable',
      undefined,
      child.signalCode !== null
    )
  const headers = new Headers()
  for (const line of headerText.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return { status, headers, text: split >= 0 ? out.slice(split).trim() : out, detail: err.trim() }
}

async function sendApi(request: ApiRequest, etag?: string) {
  if (apiUrl) return fetchApi(request, etag)
  const token = await ghToken()
  if (!token) return ghRequest(request, etag)
  const response = await fetchApi(request, etag, token)
  if (response.status !== 401) return response
  // gh may have refreshed its login since it was read.
  tokenRead = undefined
  const fresh = await ghToken()
  return fresh && fresh !== token ? fetchApi(request, etag, fresh) : response
}

async function requestApi(request: ApiRequest, revalidate = false): Promise<unknown> {
  checkBackoff()
  const cached = revalidate ? cacheRead(restCache, request.path) : undefined
  const started = performance.now()
  let response: ApiResponse
  try {
    response = await sendApi(request, cached?.etag)
  } catch (error) {
    if (error instanceof GhFailure) throw error
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new GhFailure(
      'unavailable',
      timedOut ? 'GitHub timed out' : 'GitHub API is unavailable',
      undefined,
      timedOut
    )
  }
  const { status, headers, text, detail } = response
  if (process.env.JETTY_PR_FETCH_DEBUG === '1')
    console.debug(
      `[pr-api] ${request.method} ${request.path} ${(request.body ?? '').replace(/\s+/g, ' ').slice(0, 400)} status=${status} ms=${Math.round(performance.now() - started)} bytes=${text.length}`
    )
  let value: unknown = null
  try {
    if (text) value = JSON.parse(text)
  } catch {
    if (status < 400 && status !== 304)
      throw new GhFailure('unavailable', 'Invalid response from GitHub')
  }
  const errors = record(value).errors
  const errorDetails = Array.isArray(errors)
    ? errors
        .map((error) => {
          if (typeof error === 'string') return error
          const value = record(error)
          return (
            string(value.message) ||
            [string(value.resource), string(value.field), string(value.code)]
              .filter(Boolean)
              .join(' ')
          )
        })
        .filter(Boolean)
    : []
  const message =
    [string(record(value).message), ...errorDetails].filter(Boolean).join('; ') || detail
  observeRateLimit(headers, value, status, message)
  if (status === 304 && cached) return cached.value
  const graph = request.path === 'graphql'
  const partialGraph =
    graph &&
    Boolean(record(value).data) &&
    errors &&
    status < 400 &&
    !/rate limit|abuse detection/i.test(message)
  if (!partialGraph && (status >= 400 || errors)) {
    if (
      status === 429 ||
      (status === 403 && backingOff()) ||
      /rate limit|abuse detection/i.test(message)
    )
      throw new GhFailure('rate_limited', message || 'GitHub rate limit reached', status)
    if (
      graph &&
      Array.isArray(errors) &&
      errors.some((error) => ['FORBIDDEN', 'NOT_FOUND'].includes(string(record(error).type)))
    )
      throw new GhFailure('not_found', 'GitHub denied this operation', 403)
    if (status === 404)
      throw new GhFailure('not_found', 'Pull request not found or access denied', status)
    throw new GhFailure(
      'unavailable',
      message || 'GitHub API is unavailable',
      status,
      status === 502 ||
        status === 504 ||
        (Array.isArray(errors) &&
          errors.some((error) =>
            ['MAX_NODE_LIMIT_EXCEEDED', 'RESOURCE_LIMITS_EXCEEDED'].includes(
              string(record(error).type)
            )
          )) ||
        /timeout|timed out|exceeds the maximum|complexity/i.test(message)
    )
  }
  if (request.method === 'GET')
    cacheWrite(restNext, request.path, /rel="next"/.test(headers.get('link') ?? ''), 512)
  const etag = headers.get('etag')
  if (revalidate && etag) cacheWrite(restCache, request.path, { etag, value }, 512)
  return value
}

function shared(key: string, request: () => Promise<unknown>) {
  const existing = apiInFlight.get(key)
  if (existing) return existing
  const promise = request().finally(() => apiInFlight.delete(key))
  apiInFlight.set(key, promise)
  return promise
}

// REST reads share in-flight requests. Only a read that can come back unchanged keeps its body to
// revalidate with its ETag: commit-pinned reads are cached by sha above this, and a PR's file
// pages are only re-read once its head has moved.
export function restGet(path: string, { revalidate = false } = {}) {
  return shared(path, () => requestApi({ method: 'GET', path }, revalidate))
}

function graphql(query: string, variables: Record<string, string> = {}) {
  const body = JSON.stringify({ query, variables })
  return shared(body, () => requestApi({ method: 'POST', path: 'graphql', body }))
}

function githubWrite(method: string, path: string, body: string) {
  return requestApi({ method, path, body })
}

type DiffContents = string | null | { unavailable: 'tooLarge' | 'binary' }

const maxDiffContentsBytes = 1024 * 1024

function cacheRead<T>(cache: Map<string, T>, key: string) {
  const value = cache.get(key)
  if (value !== undefined) {
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

function cacheWrite<T>(cache: Map<string, T>, key: string, value: T, limit = 64) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > limit) cache.delete(cache.keys().next().value!)
}

const diffContentsCache = new Map<string, Promise<DiffContents>>()
const mergeBaseCache = new Map<string, Promise<string>>()

function validDiffPath(path: string) {
  return (
    !path.includes('\0') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

async function fetchDiffContents(repo: string, sha: string, path: string): Promise<DiffContents> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  let response: Record<string, unknown>
  try {
    response = record(await restGet(`repos/${repo}/contents/${encodedPath}?ref=${sha}`))
  } catch (error) {
    if (error instanceof GhFailure && error.kind === 'not_found') return null
    throw error
  }
  if (response.type !== 'file') return { unavailable: 'binary' }
  if (Number(response.size) > maxDiffContentsBytes) return { unavailable: 'tooLarge' }
  if (response.encoding !== 'base64' || typeof response.content !== 'string')
    return { unavailable: 'binary' }
  const bytes = Buffer.from(response.content, 'base64')
  if (bytes.length > maxDiffContentsBytes) return { unavailable: 'tooLarge' }
  if (bytes.includes(0)) return { unavailable: 'binary' }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { unavailable: 'binary' }
  }
}

function cachedDiffContents(repo: string, sha: string, path: string) {
  const key = `${repo}\0${sha}\0${path}`
  const existing = cacheRead(diffContentsCache, key)
  if (existing) return existing
  const pending = fetchDiffContents(repo, sha, path)
  cacheWrite(diffContentsCache, key, pending)
  pending.catch(() => {
    if (diffContentsCache.get(key) === pending) diffContentsCache.delete(key)
  })
  return pending
}

function cachedMergeBase(repo: string, baseSha: string, headSha: string) {
  const key = `${repo}\0${baseSha}\0${headSha}`
  const existing = cacheRead(mergeBaseCache, key)
  if (existing) return existing
  const pending = restGet(`repos/${repo}/compare/${baseSha}...${headSha}?per_page=1`).then(
    (response) => {
      const sha = string(record(record(response).merge_base_commit).sha)
      if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error('GitHub merge base unavailable')
      return sha
    }
  )
  cacheWrite(mergeBaseCache, key, pending)
  pending.catch(() => {
    if (mergeBaseCache.get(key) === pending) mergeBaseCache.delete(key)
  })
  return pending
}

export async function pullRequestDiffFile(params: {
  repo: string
  baseSha: string
  headSha: string
  path: string
  prevPath?: string
}) {
  const { repo, baseSha, headSha, path, prevPath = path } = params
  if (
    !validRepo(repo) ||
    !/^[a-f0-9]{40,64}$/i.test(baseSha) ||
    !/^[a-f0-9]{40,64}$/i.test(headSha) ||
    !validDiffPath(path) ||
    !validDiffPath(prevPath)
  )
    throw new StoreError('invalid_params', 'Invalid pull request diff file')
  const mergeBaseSha = await cachedMergeBase(repo, baseSha, headSha)
  const [before, after] = await Promise.all([
    cachedDiffContents(repo, mergeBaseSha, prevPath),
    cachedDiffContents(repo, headSha, path),
  ])
  if (typeof before === 'object' && before) return before
  if (typeof after === 'object' && after) return after
  if (before === null && after === null) return { unavailable: 'missing' as const }
  return { before, after }
}

async function queryGraphql(query: string): Promise<unknown> {
  for (const size of [100, 50, 25, 10]) {
    try {
      return await graphql(query.replaceAll('first:100', `first:${size}`))
    } catch (error) {
      if (
        !(error instanceof GhFailure) ||
        !error.tooLarge ||
        size === 10 ||
        !query.includes('first:100')
      )
        throw error
    }
  }
  throw new GhFailure('unavailable', 'GitHub could not read pull request data')
}

type Graph = Exclude<Awaited<ReturnType<typeof fetchGraphqlBatch>>[number], GhFailure>

async function fetchGraphqlBatch(
  refs: readonly (PullRequestRef & {
    headSha?: string
    references?: readonly PullRequestReference[]
  })[],
  fields = pullRequestGraphqlFields
) {
  const response = record(await queryGraphql(pullRequestGraphqlQuery(refs, fields)))
  const data = record(response.data)
  const errors = Array.isArray(response.errors) ? response.errors.map(record) : []
  return Promise.all(
    refs.map(async (ref, index) => {
      try {
        const alias = `p${index}`
        const failed = errors.filter(
          (error) => Array.isArray(error.path) && error.path[0] === alias
        )
        if (failed.some((error) => error.type === 'NOT_FOUND'))
          return new GhFailure('not_found', 'Pull request not found or access denied')
        const value = keepFailedFields(
          prKey(ref),
          fields,
          record(data[alias]).pullRequest,
          failed.map((error) => error.path as unknown[])
        )
        if (!value)
          return failed.length
            ? new GhFailure('unavailable', 'GitHub could not read this pull request')
            : new GhFailure('not_found', 'Pull request not found or access denied')
        if (fields === pullRequestGraphqlFields) await paginatePullRequest(ref, value)
        cacheWrite(lastPulls, `${prKey(ref)}\0${fields}`, value, 32)
        const graph = mapPullRequestGraphql(value)
        const comparison = record(record(graph.pull.baseRef).compare)
        const behindBy = comparison.behindBy
        return {
          ...graph,
          viewer: user(data.viewer),
          referenceTargets: ref.references ?? [],
          references: mapPullRequestReferences(data, ref.references ?? [], index),
          behindBy:
            record(comparison.headTarget).oid === graph.pull.headRefOid &&
            typeof behindBy === 'number'
              ? behindBy
              : null,
        }
      } catch (error) {
        return error instanceof GhFailure
          ? error
          : new GhFailure('unavailable', 'GitHub could not read this pull request')
      }
    })
  )
}

// Bounded raw reads preserve fields when GitHub returns partial errors.
const lastPulls = new Map<string, Record<string, unknown>>()

function keepFailedFields(
  key: string,
  fields: string,
  value: unknown,
  paths: readonly unknown[][]
) {
  const previous = cacheRead(lastPulls, `${key}\0${fields}`)
  const pull = structuredClone(value ? record(value) : paths.length ? previous : undefined)
  if (!pull) return undefined
  if (value && previous)
    for (const path of paths) {
      const field = path[2]
      if (typeof field === 'string' && field in previous && canKeepField(previous, pull, field))
        pull[field] = structuredClone(previous[field])
    }
  if (paths.length)
    console.warn(
      `[pr-fetch] ${key} kept previous ${paths.map((path) => path.slice(2).join('.')).join(', ')}`
    )
  return pull
}

function canKeepField(
  previous: Record<string, unknown>,
  pull: Record<string, unknown>,
  field: string
) {
  return (
    !['commits', 'commitHistory', 'files', 'reviewThreads'].includes(field) ||
    !('headRefOid' in pull) ||
    (previous.headRefOid ?? headOid(previous)) === pull.headRefOid
  )
}

function headOid(pull: Record<string, unknown>) {
  return record(record(nodes(pull.commits)[0]).commit).oid
}

async function paginatePullRequest(ref: PullRequestRef, pull: Record<string, unknown>) {
  await Promise.all(
    Object.keys(pullRequestConnections).map(async (field) => {
      const connection = record(pull[field])
      while (record(connection.pageInfo).hasNextPage === true) {
        const cursor = string(record(connection.pageInfo).endCursor)
        if (!cursor) break
        const response = record(
          await queryGraphql(pullRequestGraphqlQuery([ref], connectionField(field, cursor)))
        )
        const errors = Array.isArray(response.errors) ? response.errors.map(record) : []
        const failed = errors.filter((error) => Array.isArray(error.path) && error.path[0] === 'p0')
        if (failed.length) {
          const previous = cacheRead(lastPulls, `${prKey(ref)}\0${pullRequestGraphqlFields}`)
          if (
            !previous?.[field] ||
            !canKeepField(previous, pull, field) ||
            failed.some(
              (error) => (error.path as unknown[])[2] !== field || error.type === 'NOT_FOUND'
            )
          )
            throw new GhFailure('unavailable', 'GitHub could not paginate pull request data')
          const restored = keepFailedFields(
            prKey(ref),
            pullRequestGraphqlFields,
            pull,
            failed.map((error) => error.path as unknown[])
          )
          pull[field] = restored![field]
          break
        }
        const next = record(record(record(record(response.data).p0).pullRequest)[field])
        if (!next.pageInfo || record(next.pageInfo).endCursor === cursor)
          throw new GhFailure('unavailable', 'GitHub returned an incomplete connection page')
        connection.nodes = [...nodes(connection), ...nodes(next)]
        connection.pageInfo = next.pageInfo
      }
    })
  )
  // Few threads outgrow their first page of comments; those that do page in parallel.
  await Effect.runPromise(
    Effect.forEach(
      nodes(pull.reviewThreads),
      (value) => Effect.promise(() => paginateThread(ref, pull, record(value))),
      { concurrency: 4, discard: true }
    )
  )
}

async function paginateThread(
  ref: PullRequestRef,
  pull: Record<string, unknown>,
  thread: Record<string, unknown>
) {
  const connection = record(thread.comments)
  while (record(connection.pageInfo).hasNextPage === true) {
    const cursor = string(record(connection.pageInfo).endCursor)
    if (!cursor) break
    const response = record(
      await graphql(`query {
      rateLimit { cost remaining resetAt }
      node(id:${JSON.stringify(thread.id)}) { ... on PullRequestReviewThread {
        comments(first:100,after:${JSON.stringify(cursor)}) { ${pageFields} nodes { ${reviewCommentFields} } }
      } }
    }`)
    )
    const errors = Array.isArray(response.errors) ? response.errors.map(record) : []
    if (errors.some((error) => Array.isArray(error.path) && error.path[0] === 'node')) {
      const previous = cacheRead(lastPulls, `${prKey(ref)}\0${pullRequestGraphqlFields}`)
      const saved =
        previous &&
        previous.headRefOid === pull.headRefOid &&
        !errors.some((error) => error.type === 'NOT_FOUND')
          ? nodes(previous.reviewThreads).find((value) => record(value).id === thread.id)
          : undefined
      if (!record(saved).comments)
        throw new GhFailure('unavailable', 'GitHub could not paginate review comments')
      thread.comments = structuredClone(record(saved).comments)
      return
    }
    const next = record(record(record(response.data).node).comments)
    if (!next.pageInfo || record(next.pageInfo).endCursor === cursor)
      throw new GhFailure('unavailable', 'GitHub returned an incomplete review comment page')
    connection.nodes = [...nodes(connection), ...nodes(next)]
    connection.pageInfo = next.pageInfo
  }
}

const restNext = new Map<string, boolean>()

async function ghPages(path: string, total?: number): Promise<unknown[]> {
  const items: unknown[] = []
  for (let page = 1; page <= 30; page++) {
    const endpoint = `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`
    const result = await restGet(endpoint)
    if (!Array.isArray(result)) throw new GhFailure('unavailable', 'Invalid GitHub file list')
    items.push(...result)
    if (page === 1 && total && total > 100 && cacheRead(restNext, endpoint) !== false) {
      const pages = Array.from(
        { length: Math.min(30, Math.ceil(total / 100)) - 1 },
        (_, index) => index + 2
      )
      const rest = await Effect.runPromise(
        Effect.forEach(
          pages,
          (next) =>
            Effect.promise(async () => {
              const result = await restGet(
                `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${next}`
              )
              if (!Array.isArray(result))
                throw new GhFailure('unavailable', 'Invalid GitHub file list')
              return result
            }),
          { concurrency: 4 }
        )
      )
      return [...items, ...rest.flat()]
    }
    if (cacheRead(restNext, endpoint) === false || result.length < 100) break
  }
  return items
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback
}

export function mapCheckRuns(checks: readonly unknown[]): PullRequestData['checkRuns'] {
  return checks.map((value): PullRequestData['checkRuns'][number] => {
    const check = record(value)
    if (check.__typename === 'StatusContext') {
      const state = string(check.state)
      return {
        id: string(check.id),
        name: string(check.context),
        kind: 'status',
        workflow: null,
        event: null,
        description: typeof check.description === 'string' ? check.description : null,
        required: check.isRequired === true,
        status: state === 'PENDING' || state === 'EXPECTED' ? 'queued' : 'completed',
        conclusion:
          state === 'SUCCESS'
            ? 'success'
            : state === 'FAILURE' || state === 'ERROR'
              ? 'failure'
              : null,
        // A status is a posted state, not a run, so it has no duration to show.
        started_at: '',
        completed_at: state === 'PENDING' || state === 'EXPECTED' ? null : string(check.updatedAt),
        html_url: string(check.targetUrl),
        app: { name: 'GitHub' },
      }
    }
    const suite = record(check.checkSuite)
    const workflow = string(record(record(suite.workflowRun).workflow).name)
    const status = string(check.status)
    return {
      id: string(check.id),
      name: string(check.name),
      kind: 'run',
      workflow: workflow || null,
      event:
        typeof record(suite.workflowRun).event === 'string'
          ? string(record(suite.workflowRun).event)
          : null,
      description: null,
      required: check.isRequired === true,
      status:
        status === 'COMPLETED' ? 'completed' : status === 'IN_PROGRESS' ? 'in_progress' : 'queued',
      conclusion:
        check.conclusion === null
          ? null
          : enumValue(
              string(check.conclusion).toLowerCase(),
              [
                'success',
                'failure',
                'neutral',
                'cancelled',
                'skipped',
                'timed_out',
                'action_required',
                'stale',
                'startup_failure',
              ] as const,
              'neutral'
            ),
      started_at: string(check.startedAt),
      completed_at: typeof check.completedAt === 'string' ? check.completedAt : null,
      html_url: string(check.detailsUrl),
      app: { name: string(record(suite.app).name, 'GitHub') },
    }
  })
}

function mapFile(value: unknown): PullRequestData['files'][number] {
  const file = record(value)
  return {
    sha: string(file.sha),
    filename: string(file.filename),
    status: enumValue(file.status, ['added', 'removed', 'modified', 'renamed'], 'modified'),
    additions: Number(file.additions) || 0,
    deletions: Number(file.deletions) || 0,
    changes: Number(file.changes) || 0,
    ...(typeof file.previous_filename === 'string'
      ? { previous_filename: file.previous_filename }
      : {}),
    ...(typeof file.patch === 'string' ? { patch: file.patch } : {}),
  }
}

function mapReviewComment(
  value: unknown,
  thread: Record<string, unknown>
): PullRequestData['reviewComments'][number] {
  const comment = record(value)
  const reply = Number(record(comment.replyTo).databaseId)
  return {
    id: Number(comment.databaseId),
    user: user(comment.author),
    body: string(comment.body),
    path: string(thread.path, string(comment.path)),
    line: typeof thread.line === 'number' ? thread.line : null,
    diff_hunk: string(comment.diffHunk),
    thread_id: string(thread.id),
    outdated: thread.isOutdated === true,
    side: thread.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
    start_line: typeof thread.startLine === 'number' ? thread.startLine : null,
    created_at: string(comment.createdAt),
    html_url: string(comment.url),
    ...(reply ? { in_reply_to_id: reply } : {}),
    pull_request_review_id: Number(record(comment.pullRequestReview).databaseId) || 0,
    resolved: thread.isResolved === true,
  }
}

type PullRequestFile = PullRequestData['files'][number]

// Lockfiles GitHub's Linguist leaves unmarked.
const generatedNames = new Set(['yarn.lock', 'go.sum', 'Gemfile.lock'])
const generatedBanner = /@generated\b|\bdo not edit\b/i
// Banners are looked for in a file's first 2 KiB.
const headBytes = 2048
// Whether a file's head carries a banner, by blob SHA.
const headVerdicts = new Map<string, boolean>()

// The file's first lines as its patch shows them, when the first hunk starts at line 1.
function patchHead(file: PullRequestFile) {
  const removed = file.status === 'removed'
  const start = file.patch?.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)
  if (!file.patch || Number(start?.[removed ? 1 : 2]) !== 1) return undefined
  const lines = file.patch.slice(0, 4 * headBytes).split('\n')
  let head = ''
  for (const line of lines.slice(1)) {
    if (line.startsWith('@@') || head.length >= headBytes) break
    if (line[0] === ' ' || line[0] === (removed ? '-' : '+')) head += `${line.slice(1)}\n`
  }
  return head
}

// Undefined until the file's head has been seen: added and removed files show it whole.
function headVerdict(file: PullRequestFile) {
  const known = cacheRead(headVerdicts, file.sha)
  if (known !== undefined) return known
  const head = patchHead(file)
  if (head === undefined) return undefined
  const verdict = generatedBanner.test(head.slice(0, headBytes))
  if (!verdict && head.length < headBytes && file.status !== 'added' && file.status !== 'removed')
    return undefined
  if (file.sha) cacheWrite(headVerdicts, file.sha, verdict, 10_000)
  return verdict
}

// GitHub's flag plus what Linguist misses; never unmarks a file.
function markGenerated(file: PullRequestFile): PullRequestFile {
  const name = file.filename.slice(file.filename.lastIndexOf('/') + 1)
  return file.generated || !(generatedNames.has(name) || headVerdict(file))
    ? file
    : { ...file, generated: true }
}

// The first bytes of a body; a server that ignores Range sends the whole file, so the rest is dropped.
async function firstBytes(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel()
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit))
}

async function readHead(repo: string, sha: string, file: PullRequestFile, token: string) {
  const path = file.filename.split('/').map(encodeURIComponent).join('/')
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path}`, {
      headers: {
        Authorization: `token ${token}`,
        Range: `bytes=0-${headBytes - 1}`,
        'Accept-Encoding': 'identity',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 429) observeRateLimit(response.headers, null, response.status)
    if (response.status !== 200 && response.status !== 206) return await response.body?.cancel()
    const head = await firstBytes(response, headBytes)
    cacheWrite(headVerdicts, file.sha, generatedBanner.test(head), 10_000)
  } catch {
    // An unread head leaves the file as GitHub classed it.
  }
}

// Ranged reads of the heads patches don't show, at most 100 per head, while `wanted` holds and
// GitHub isn't asking to back off. Whether every read was tried.
async function readHeads(
  repo: string,
  sha: string,
  files: readonly PullRequestFile[],
  wanted: () => boolean
) {
  const unread = files
    .filter(
      (file) =>
        file.status !== 'removed' &&
        file.sha &&
        !file.generated &&
        !file.binary &&
        headVerdict(file) === undefined
    )
    .slice(0, 100)
  if (!unread.length) return true
  if (backingOff()) return false
  const token = await ghToken()
  if (!token) return true
  let complete = true
  await Effect.runPromise(
    Effect.forEach(
      unread,
      (file) =>
        Effect.promise(async () => {
          if (!wanted() || backingOff()) complete = false
          else await shared(`head ${file.sha}`, () => readHead(repo, sha, file, token))
        }),
      { concurrency: 8, discard: true }
    )
  )
  return complete
}

type FileFlags = { binary: boolean; generated: boolean }
const treeFlags = new Map<string, Map<string, FileFlags>>()

async function classifyFiles(
  repo: string,
  headSha: string,
  baseSha: string | null,
  files: readonly PullRequestData['files'][number][],
  ref?: PullRequestRef,
  headRepo = repo,
  // Body references a cold read couldn't know to ask for ride along on the first query.
  references: readonly PullRequestReference[] = []
) {
  const directories = new Map<string, { repo: string; sha: string; dir: string }>()
  for (const file of files) {
    const sha = file.status === 'removed' ? baseSha : headSha
    if (!sha) continue
    const dir = file.filename.slice(0, Math.max(0, file.filename.lastIndexOf('/')))
    const sourceRepo = file.status === 'removed' ? repo : headRepo
    const key = `${sourceRepo.toLowerCase()}\0${sha}\0${dir}`
    directories.set(key, { repo: sourceRepo, sha, dir })
  }
  const directoryFlags = new Map<string, Map<string, FileFlags>>()
  for (const [key] of directories) {
    const cached = cacheRead(treeFlags, key)
    if (cached) directoryFlags.set(key, cached)
  }
  const missing = [...directories].filter(([key]) => !directoryFlags.has(key))
  let revisionMatches = true
  const batches = []
  // At most 20 directories a query, split evenly.
  const batchSize = Math.ceil(missing.length / Math.ceil(missing.length / 20))
  for (let offset = 0; offset < missing.length; offset += batchSize)
    batches.push(missing.slice(offset, offset + batchSize))
  if (!batches.length && ref) batches.push([])
  let referenceData: unknown
  async function loadFlags(batch: typeof missing, withReferences: boolean) {
    const [owner, name] = repo.split('/')
    let response: Record<string, unknown>
    try {
      response = record(
        await graphql(`query {
      rateLimit { cost remaining resetAt }
      ${batch
        .map(([, item], index) => {
          const [sourceOwner, sourceName] = item.repo.split('/')
          return `d${index}: repository(owner:${JSON.stringify(sourceOwner)},name:${JSON.stringify(sourceName)}) {
          object(expression:${JSON.stringify(`${item.sha}:${item.dir}`)}) {
            ... on Tree { entries { path isGenerated object { ... on Blob { isBinary } } } }
          }
        }`
        })
        .join('\n')}
      ${
        ref
          ? `repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
        pullRequest(number:${ref.number}) { headRefOid baseRefOid }
      }`
          : ''
      }
      ${withReferences ? pullRequestReferenceFields(references, 0) : ''}
    }`)
      )
    } catch (error) {
      if (!(error instanceof GhFailure) || !error.tooLarge || batch.length < 2) throw error
      const middle = Math.ceil(batch.length / 2)
      await loadFlags(batch.slice(0, middle), withReferences)
      await loadFlags(batch.slice(middle), false)
      return
    }
    // A reference that doesn't resolve fails on its own; file metadata must not.
    const errors = Array.isArray(response.errors) ? response.errors.map(record) : []
    if (
      errors.some((error) => !/^r0_\d+$/.test(String((error.path as unknown[] | undefined)?.[0])))
    )
      throw new GhFailure('unavailable', 'GitHub could not read file metadata')
    if (withReferences) referenceData = response.data
    const result = record(response.data)
    const repository = record(result.repository)
    if (ref) {
      const pull = record(repository.pullRequest)
      revisionMatches &&= pull.headRefOid === headSha && pull.baseRefOid === baseSha
    }
    for (const [index, [key]] of batch.entries()) {
      const flags = new Map<string, FileFlags>()
      for (const value of (record(record(result[`d${index}`]).object).entries as
        | unknown[]
        | undefined) ?? []) {
        const entry = record(value)
        flags.set(string(entry.path), {
          binary: record(entry.object).isBinary === true,
          generated: entry.isGenerated === true,
        })
      }
      directoryFlags.set(key, flags)
      cacheWrite(treeFlags, key, flags)
    }
  }
  await Effect.runPromise(
    Effect.forEach(
      batches,
      (batch, index) => Effect.promise(() => loadFlags(batch, !index && references.length > 0)),
      { concurrency: 4, discard: true }
    )
  )
  return {
    revisionMatches,
    references:
      referenceData === undefined
        ? undefined
        : mapPullRequestReferences(referenceData, references, 0),
    files: files.map((file) => {
      const sha = file.status === 'removed' ? baseSha : headSha
      const dir = file.filename.slice(0, Math.max(0, file.filename.lastIndexOf('/')))
      const sourceRepo = file.status === 'removed' ? repo : headRepo
      const flags = directoryFlags
        .get(`${sourceRepo.toLowerCase()}\0${sha}\0${dir}`)
        ?.get(file.filename)
      return { ...file, binary: flags?.binary ?? false, generated: flags?.generated ?? false }
    }),
  }
}

const commitFilesCache = new Map<
  string,
  Promise<{ files: PullRequestData['files']; parentSha: string | null }>
>()

export function pullRequestCommitFiles(repo: string, sha: string) {
  if (!validRepo(repo) || !/^[a-f0-9]{40,64}$/i.test(sha))
    throw new StoreError('invalid_params', 'Invalid commit')
  const key = `${repo.toLowerCase()}\0${sha.toLowerCase()}`
  const cached = cacheRead(commitFilesCache, key)
  if (cached) return cached
  async function load() {
    const files: PullRequestData['files'][number][] = []
    let parentSha: string | null = null
    for (let page = 1; page <= 30; page++) {
      const endpoint = `repos/${repo}/commits/${sha}?per_page=100&page=${page}`
      const result = record(await restGet(endpoint))
      if (page === 1)
        parentSha = string(record((result.parents as unknown[] | undefined)?.[0]).sha) || null
      const values = (result.files as unknown[] | undefined) ?? []
      files.push(...values.map(mapFile))
      if (cacheRead(restNext, endpoint) === false || values.length < 100) break
    }
    const classified = await classifyFiles(repo, sha, parentSha, files)
    return { files: classified.files.map(markGenerated), parentSha }
  }
  const promise = load()
  cacheWrite(commitFilesCache, key, promise)
  void promise.catch(() => {
    if (commitFilesCache.get(key) === promise) commitFilesCache.delete(key)
  })
  return promise
}

function inlinePatches(files: PullRequestData['files']) {
  let remaining = 1024 * 1024
  return files.map((file) => {
    const bytes = Buffer.byteLength(file.patch ?? '')
    if (bytes <= remaining) {
      remaining -= bytes
      return file
    }
    const { patch: _patch, ...metadata } = file
    return { ...metadata, patchDeferred: true }
  })
}

async function fetchPullRequest(
  ref: PullRequestRef,
  graph: Graph,
  previous?: PullRequestData,
  retry = false
): Promise<PullRequestData> {
  const pull = graph.pull
  const headSha = string(pull.headRefOid)
  const baseSha = string(pull.baseRefOid)
  const reuseFiles =
    previous?.pull.head.sha === headSha &&
    previous.pull.changed_files === Number(pull.changedFiles) &&
    previous.pull.additions === Number(pull.additions) &&
    previous.pull.deletions === Number(pull.deletions)
  const sameBase = previous?.pull.base.sha === baseSha
  const targets = findPullRequestReferences(string(pull.body), ref)
  const queried = new Set(graph.referenceTargets.map(referenceKey))
  const missing = targets.filter((target) => !queried.has(referenceKey(target)))
  let found: ReturnType<typeof mapPullRequestReferences> | undefined
  let files = reuseFiles
    ? previous.files
    : (await ghPages(`repos/${ref.repo}/pulls/${ref.number}/files`, Number(pull.changedFiles))).map(
        mapFile
      )
  if (
    !reuseFiles ||
    !sameBase ||
    files.some((file) => typeof file.binary !== 'boolean' || typeof file.generated !== 'boolean')
  ) {
    const classified = await classifyFiles(
      ref.repo,
      headSha,
      baseSha,
      files,
      reuseFiles && sameBase ? undefined : ref,
      string(record(pull.headRepository).nameWithOwner, ref.repo),
      missing
    )
    if (!classified.revisionMatches) {
      if (retry) throw new GhFailure('unavailable', 'Pull request changed while loading its diff')
      const [next] = await fetchGraphqlBatch([
        { ...ref, headSha, references: graph.referenceTargets },
      ])
      if (!next || next instanceof GhFailure)
        throw next ?? new GhFailure('unavailable', 'Pull request is unavailable')
      return fetchPullRequest(ref, next, previous, true)
    }
    files = classified.files
    found = classified.references
  }
  const viewed = new Map(
    nodes(pull.files).map((value) => {
      const file = record(value)
      return [
        string(file.path),
        enumValue(file.viewerViewedState, ['VIEWED', 'UNVIEWED', 'DISMISSED'] as const, 'UNVIEWED'),
      ] as const
    })
  )
  files = files.map((file) => ({
    ...markGenerated(file),
    viewed: viewed.get(file.filename) ?? ('UNVIEWED' as const),
  }))
  const repository = record(pull.repository)
  const reviewers = mapReviewers(pull)
  const { requestedUsers, requestedTeams } = requestedReviewers(reviewers.reviewRequests)
  let references = graph.references
  if (missing.length) {
    found ??= mapPullRequestReferences(
      record(
        await graphql(`query { rateLimit { cost remaining resetAt } ${pullRequestReferenceFields(missing, 0)} }`)
      ).data,
      missing,
      0
    )
    references = [...references, ...found]
  }
  const wanted = new Set(targets.map(referenceKey))
  const eventKinds = {
    ReadyForReviewEvent: 'ready_for_review',
    ConvertToDraftEvent: 'converted_to_draft',
    ClosedEvent: 'closed',
    ReopenedEvent: 'reopened',
  } as const
  const statusEvents: NonNullable<PullRequestData['statusEvents']>[number][] = []
  for (const value of nodes(pull.timelineItems)) {
    const event = record(value)
    const kind = eventKinds[event.__typename as keyof typeof eventKinds]
    if (kind)
      statusEvents.push({
        kind,
        actor: event.actor ? user(event.actor) : null,
        at: string(event.createdAt),
      })
  }
  statusEvents.sort((a, b) => a.at.localeCompare(b.at))
  const firstDraftEvent = statusEvents.find(
    (event) => event.kind === 'ready_for_review' || event.kind === 'converted_to_draft'
  )
  const reviewComments = nodes(pull.reviewThreads).flatMap((value) => {
    const thread = record(value)
    return nodes(thread.comments)
      .filter((comment) => record(comment).state !== 'PENDING')
      .map((comment) => mapReviewComment(comment, thread))
  })
  const fixture = {
    pull: {
      node_id: string(pull.id),
      number: Number(pull.number),
      title: string(pull.title),
      state: pull.state === 'OPEN' ? 'open' : 'closed',
      draft: pull.isDraft === true,
      merged: pull.merged === true,
      merged_at: pull.mergedAt ?? null,
      merged_by: pull.mergedBy ? user(pull.mergedBy) : null,
      html_url: string(pull.url),
      body: string(pull.body),
      user: user(pull.author),
      created_at: string(pull.createdAt),
      updated_at: string(pull.updatedAt),
      head: { ref: string(pull.headRefName), sha: headSha },
      base: { ref: string(pull.baseRefName), sha: baseSha },
      additions: Number(pull.additions),
      deletions: Number(pull.deletions),
      changed_files: Number(pull.changedFiles),
      commits: Number(record(pull.commitHistory).totalCount),
      comments: Number(record(pull.comments).totalCount),
      review_comments: reviewComments.length,
      mergeable_state: mergeableState(pull.mergeStateStatus),
      requested_reviewers: requestedUsers,
      labels: nodes(pull.labels).map((value) => ({ name: string(record(value).name) })),
    },
    reviews: nodes(pull.reviews).map((value) => {
      const review = record(value)
      return {
        id: Number(review.databaseId),
        user: user(review.author),
        state: enumValue(
          review.state,
          ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED'],
          'COMMENTED'
        ),
        body: string(review.body),
        submitted_at: string(review.submittedAt),
        html_url: string(review.url),
      }
    }),
    reviewComments,
    issueComments: graph.issueComments,
    checkRuns: mapCheckRuns(graph.checks),
    checkRollupState: graph.checkRollupState,
    checkRunsTotalCount: graph.checkRunsTotalCount,
    commits: nodes(pull.commitHistory).map((value) => {
      const commit = record(record(value).commit)
      const author = record(commit.author)
      return {
        sha: string(commit.oid),
        commit: {
          message: string(commit.message),
          author: { name: string(author.name), date: string(commit.authoredDate) },
        },
        author: author.user ? user(author.user) : null,
        html_url: string(commit.url),
        parents: Number(record(commit.parents).totalCount),
      }
    }),
    files: inlinePatches(files),
    statusEvents,
    openedAsDraft: firstDraftEvent
      ? firstDraftEvent.kind === 'ready_for_review'
      : pull.isDraft === true,
    viewer: graph.viewer,
    viewerCanUpdate: pull.viewerCanUpdate === true,
    closingIssuesReferences: graph.closingIssuesReferences,
    references: references.filter((reference) => wanted.has(referenceKey(reference))),
    suggestedReviewers: graph.suggestedReviewers,
    ...reviewers,
    mergeable: pull.mergeable,
    mergeStateStatus: string(pull.mergeStateStatus, 'UNKNOWN'),
    behindBy: graph.behindBy,
    truncatedConnections: [
      ...new Set([
        ...graph.truncatedConnections,
        ...(Number(pull.changedFiles) > files.length ? ['files'] : []),
      ]),
    ],
    requestedTeams,
    reviewDecision:
      (['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'] as const).find(
        (decision) => decision === graph.reviewDecision
      ) ?? null,
    viewerCanRequestReviews: ['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE'].includes(
      string(repository.viewerPermission)
    ),
    mergeCommitAllowed: repository.mergeCommitAllowed === true,
    squashMergeAllowed: repository.squashMergeAllowed === true,
    rebaseMergeAllowed: repository.rebaseMergeAllowed === true,
    viewerDefaultMergeMethod: repository.viewerDefaultMergeMethod,
  }
  return Schema.decodeUnknownSync(PullRequestData)(fixture)
}

async function fetchReviewerCandidates(repo: string, search: string) {
  const [owner = '', name = ''] = repo.split('/')
  const query = `query($owner:String!,$name:String!,$search:String) {
    rateLimit { cost remaining resetAt }
    repository(owner:$owner,name:$name) { assignableUsers(first:100,query:$search) {
      pageInfo { hasNextPage }
      nodes { login name avatarUrl url }
    } }
  }`
  const response = record(await graphql(query, { owner, name, ...(search ? { search } : {}) }))
  const users = record(record(record(response.data).repository).assignableUsers)
  const candidates: ReviewerCandidate[] = []
  for (const value of (users.nodes as unknown[] | undefined) ?? []) {
    const node = record(value)
    const login = string(node.login)
    if (!login) continue
    candidates.push({
      login,
      avatar_url: string(node.avatarUrl),
      html_url: string(node.url),
      ...(string(node.name) ? { name: string(node.name) } : {}),
    })
  }
  return { candidates, truncated: record(users.pageInfo).hasNextPage === true }
}

function writeError(error: unknown) {
  if (error instanceof StoreError) return error
  if (error instanceof GhFailure) {
    if (error.kind === 'rate_limited') return new StoreError('internal', error.message)
    if (error.status === 405)
      return new StoreError(
        'invalid_params',
        'This pull request cannot be merged. Check conflicts, required reviews, and branch rules.'
      )
    if (error.status === 409)
      return new StoreError('conflict', 'The pull request head changed. Refresh and try again.')
    if (error.status === 401 || error.status === 403 || error.status === 404)
      return new StoreError(
        'not_found',
        'GitHub denied this operation. Check your login and repository permissions.'
      )
    if (error.status === 422) {
      if (/requested from pull request author|review.*author/i.test(error.message))
        return new StoreError(
          'invalid_params',
          "Can't request a review from the pull request author"
        )
      if (/only be requested from collaborators/i.test(error.message))
        return new StoreError(
          'invalid_params',
          'Reviews can only be requested from repository collaborators'
        )
      return new StoreError('invalid_params', error.message || 'GitHub rejected this operation')
    }
    return new StoreError('internal', error.message)
  }
  return new StoreError('internal', error instanceof Error ? error.message : String(error))
}

async function sendReviewRequest(
  ref: PullRequestRef,
  login: string,
  requested: boolean,
  kind = 'user'
) {
  const reviewer = canonicalLogin(login) === 'Copilot' ? copilotWriteLogin : login
  return githubWrite(
    requested ? 'POST' : 'DELETE',
    `repos/${ref.repo}/pulls/${ref.number}/requested_reviewers`,
    JSON.stringify(
      kind === 'team'
        ? { team_reviewers: [login], reviewers: [] }
        : { reviewers: [reviewer], team_reviewers: [] }
    )
  )
}

// The pre-redesign view reads requests as REST's `requested_reviewers` and `requested_teams`.
function requestedReviewers(reviewRequests: readonly PullRequestReviewer[]) {
  return {
    requestedUsers: reviewRequests.filter((reviewer) => reviewer.kind !== 'team').map(user),
    requestedTeams: reviewRequests
      .filter((reviewer) => reviewer.kind === 'team')
      .map((reviewer) => ({
        name: reviewer.name ?? reviewer.login,
        avatar_url: reviewer.avatar_url,
        slug: reviewer.slug,
        asCodeOwner: reviewer.asCodeOwner,
      })),
  }
}

// One failed check makes the rollup FAILURE while the rest still run.
function checksRunning(data: PullRequestData | undefined) {
  return (
    data?.pull.state === 'open' &&
    (data.checkRollupState === 'PENDING' ||
      data.checkRollupState === 'EXPECTED' ||
      data.checkRuns.some((run) => run.status !== 'completed'))
  )
}

// GitHub works mergeability out lazily, so an open PR can read UNKNOWN for a while.
function mergeUnknown(data: PullRequestData | undefined) {
  return (
    data?.pull.state === 'open' &&
    (data.mergeable === 'UNKNOWN' || data.mergeStateStatus === 'UNKNOWN')
  )
}

const mergeStates = {
  CLEAN: 'clean',
  BLOCKED: 'blocked',
  DIRTY: 'dirty',
  UNSTABLE: 'unstable',
  BEHIND: 'behind',
} as const

function mergeableState(status: unknown) {
  return mergeStates[status as keyof typeof mergeStates] ?? 'unknown'
}

// Which windows subscribe to each key, and the closest attention any of them pays.
function createWatches<K>(activityOf: (client: number) => GitHubActivity) {
  const watches = new Map<K, Map<symbol, number>>()
  return {
    has: (key: K) => watches.has(key),
    keys: () => [...watches.keys()],
    activity: (key: K) => closestActivity([...(watches.get(key)?.values() ?? [])].map(activityOf)),
    watch(key: K, client: number) {
      const token = Symbol()
      return Effect.acquireRelease(
        Effect.sync(() => {
          const subscribers = watches.get(key) ?? new Map()
          subscribers.set(token, client)
          watches.set(key, subscribers)
        }),
        () =>
          Effect.sync(() => {
            const subscribers = watches.get(key)
            subscribers?.delete(token)
            if (!subscribers?.size) watches.delete(key)
          })
      )
    },
  }
}

function prKey(ref: PullRequestRef) {
  return `${ref.repo}#${ref.number}`
}

type PullRequestObserver = {
  watching: Effect.Effect<boolean, StoreError>
  changed: (
    ref: PullRequestRef,
    previous: PullRequestSnapshot,
    next: PullRequestData
  ) => Effect.Effect<void, StoreError>
}

export function createPullRequests(store: Store, hub: Hub) {
  const visibleLimit = 3
  const prefetchLimit = 2
  const queuedPrefetchLimit = 4
  type Job = {
    ref: PullRequestRef
    key: string
    priority: 'visible' | 'arrival' | 'prefetch'
    queuedAt: number
    started: boolean
    revision: number
    promise: Promise<PullRequestSnapshot | undefined>
    resolve: (snapshot: PullRequestSnapshot | undefined) => void
  }
  // Writes bump a PR's revision; a read that started before the bump is discarded.
  const revisions = new Map<string, number>()
  const pendingOperations = new Map<string, NonNullable<PullRequestSnapshot['pendingOperation']>>()
  const publication = Semaphore.makeUnsafe(1)
  // One GitHub write at a time, so quick reviewer picks and an Undo queue rather than fail.
  // Only the last queued write to a PR refreshes it, once for all of them.
  const writing = Semaphore.makeUnsafe(1)
  const queuedWrites = new Map<string, number>()
  const writesNeedRefresh = new Set<string>()
  const lastDetection = new Map<string, number>()
  const detecting = new Set<string>()
  const jobs = new Map<string, Job>()
  const queue: Job[] = []
  let activeVisible = 0
  let activePrefetches = 0
  const watches = createWatches<string>(hub.clientActivity)
  const lastChecks = new Map<string, number>()
  const checking = new Set<string>()
  const lastCadences = new Map<string, string>()
  const headsRead = new Map<string, string>()
  let linksPolledAt = 0
  let observer: PullRequestObserver | undefined

  function revision(key: string) {
    return revisions.get(key) ?? 0
  }

  function finish(job: Job, fetched: PullRequestSnapshot) {
    if (!jobs.delete(job.key)) return
    if (job.priority !== 'visible') activePrefetches--
    else activeVisible--
    void Effect.runPromise(publish(job.ref, fetched, job.revision)).then(job.resolve, (error) => {
      console.error(`[pr-fetch] ${job.key} publication failed`, error)
      if (job.revision !== revision(job.key)) return job.resolve(undefined)
      const failed: PullRequestSnapshot = {
        ...job.ref,
        status: 'unavailable',
        error: String(error),
        refreshedAt: Date.now(),
      }
      hub.pushPullRequest(failed)
      job.resolve(failed)
    })
  }

  async function fetchBatch(batch: Job[]) {
    const startedAt = Date.now()
    const refs = await Promise.all(
      batch.map(async (job) => {
        const cached = await Effect.runPromise(store.getPullRequest(job.ref.repo, job.ref.number))
        return {
          ...job.ref,
          headSha: cached.data?.pull.head.sha,
          references: findPullRequestReferences(cached.data?.pull.body ?? '', job.ref),
        }
      })
    )
    let graphs: (Graph | GhFailure)[]
    try {
      graphs = await fetchGraphqlBatch(refs)
    } catch (error) {
      const failure =
        error instanceof GhFailure ? error : new GhFailure('unavailable', String(error))
      graphs = batch.map(() => failure)
    }
    await Promise.all(
      batch.map(async (job, index) => {
        let snapshot: PullRequestSnapshot
        try {
          const graph = graphs[index]!
          if (graph instanceof GhFailure) throw graph
          snapshot = {
            ...job.ref,
            status: 'ready',
            data: await fetchPullRequest(
              job.ref,
              graph,
              (await Effect.runPromise(store.getPullRequest(job.ref.repo, job.ref.number))).data
            ),
            refreshedAt: Date.now(),
          }
        } catch (error) {
          const failure =
            error instanceof GhFailure ? error : new GhFailure('unavailable', String(error))
          snapshot = {
            ...job.ref,
            status: failure.kind,
            error: failure.message,
            refreshedAt: Date.now(),
          }
        }
        if (process.env.JETTY_PR_FETCH_DEBUG === '1')
          console.debug(
            `[pr-fetch] ${job.key} ${job.priority} batch=${batch.length} wait=${startedAt - job.queuedAt}ms fetch=${Date.now() - startedAt}ms snapshotBytes=${Buffer.byteLength(JSON.stringify(snapshot))} memory=${JSON.stringify(process.memoryUsage())}`
          )
        finish(job, snapshot)
      })
    )
  }

  let drainQueued = false
  function drain() {
    if (drainQueued) return
    drainQueued = true
    queueMicrotask(() => {
      drainQueued = false
      const batch: Job[] = []
      while (batch.length < 5) {
        let index =
          activeVisible < visibleLimit ? queue.findIndex((job) => job.priority === 'visible') : -1
        if (index < 0 && activePrefetches < prefetchLimit)
          index = queue.findIndex((job) => job.priority === 'arrival')
        if (index < 0 && activePrefetches < prefetchLimit)
          index = queue.findIndex((job) => job.priority === 'prefetch')
        if (index < 0) break
        const job = queue.splice(index, 1)[0]!
        job.started = true
        if (job.priority !== 'visible') activePrefetches++
        else activeVisible++
        batch.push(job)
      }
      if (!batch.length) return
      void fetchBatch(batch)
        .catch((error: unknown) => {
          for (const job of batch)
            finish(job, {
              ...job.ref,
              status: 'unavailable',
              error: String(error),
              refreshedAt: Date.now(),
            })
        })
        .finally(drain)
    })
  }

  function schedule(ref: PullRequestRef, priority: Job['priority'], capped = true) {
    const key = prKey(ref)
    if (pendingOperations.has(key)) return Promise.resolve(undefined)
    const existing = jobs.get(key)
    if (existing) {
      if (priority === 'visible' && existing.priority !== 'visible') {
        if (existing.started) {
          activePrefetches--
          activeVisible++
        }
        existing.priority = 'visible'
      } else if (priority === 'arrival' && existing.priority === 'prefetch') {
        existing.priority = 'arrival'
      }
      drain()
      return existing.promise
    }
    if (
      priority === 'prefetch' &&
      capped &&
      queue.filter((job) => job.priority !== 'visible').length >= queuedPrefetchLimit
    )
      return Promise.resolve(undefined)
    let resolve!: Job['resolve']
    const promise = new Promise<PullRequestSnapshot | undefined>((done) => {
      resolve = done
    })
    const job: Job = {
      ref,
      key,
      priority,
      queuedAt: Date.now(),
      started: false,
      revision: revision(key),
      promise,
      resolve,
    }
    jobs.set(key, job)
    queue.push(job)
    drain()
    return promise
  }

  // Saves a fetch and pushes it to the PR view and to every thread linking it (sidebar marks).
  // The PR watcher compares it with the read before it.
  function publish(ref: PullRequestRef, fetched: PullRequestSnapshot, fetchedRevision: number) {
    return publication.withPermit(
      Effect.gen(function* () {
        if (fetchedRevision !== revision(prKey(ref))) return undefined
        const previous =
          observer && fetched.data && (yield* observer.watching)
            ? yield* store.getPullRequest(ref.repo, ref.number)
            : undefined
        yield* store.savePullRequest(fetched)
        if (observer && previous && fetched.data)
          yield* observer
            .changed(ref, previous, fetched.data)
            .pipe(Effect.catchCause((cause) => Effect.logWarning(cause)))
        // The stored snapshot keeps the last good data when this read failed.
        const snapshot = decorate(yield* store.getPullRequest(ref.repo, ref.number))
        hub.pushPullRequest(snapshot)
        if (snapshot.data && watches.has(prKey(ref))) markGeneratedHeads(ref, snapshot.data)
        for (const threadId of yield* store.threadsForPullRequest(ref.repo, ref.number)) {
          const thread = yield* store.requireThread(threadId)
          hub.pushChrome({ type: 'thread.upserted', thread })
        }
        return snapshot
      })
    )
  }

  function refresh(ref: PullRequestRef): Effect.Effect<PullRequestSnapshot, StoreError> {
    return Effect.promise(() => schedule(ref, 'visible')).pipe(
      Effect.flatMap((published) => (published ? Effect.succeed(published) : get(ref)))
    )
  }

  function watch(ref: PullRequestRef, client: number) {
    return watches.watch(prKey(ref), client)
  }

  function cadence(closed: boolean, state: GitHubActivity, list: boolean) {
    if (state === 'hidden' || backingOff()) return null
    const interval = closed ? 30 * 60_000 : list || state === 'blurred' ? 120_000 : 30_000
    return interval * cadenceMultiplier()
  }

  function decorate(snapshot: PullRequestSnapshot): PullRequestSnapshot {
    const key = prKey(snapshot)
    const watched = watches.has(key)
    const state = watched ? watches.activity(key) : hub.githubActivity()
    const interval = cadence(snapshot.data?.pull.state === 'closed', state, !watched)
    const checksInterval =
      interval !== null && (checksRunning(snapshot.data) || mergeUnknown(snapshot.data))
        ? (watched && state === 'focused' ? 10_000 : 30_000) * cadenceMultiplier()
        : null
    const health = `${interval ?? 'paused'}/${checksInterval ?? 'paused'}`
    if (lastCadences.get(key) !== health) {
      lastCadences.set(key, health)
      console.info(`[pr-rate] ${key} cadence=${health}ms activity=${state}`)
    }
    return {
      ...snapshot,
      pendingOperation: pendingOperations.get(key),
      rateLimit: githubRateLimitHealth(interval, checksInterval),
    }
  }

  function get(ref: PullRequestRef) {
    return store.getPullRequest(ref.repo, ref.number).pipe(Effect.map(decorate))
  }

  function refreshIfStale(ref: PullRequestRef, maxAge?: number) {
    return Effect.gen(function* () {
      const snapshot = yield* get(ref)
      const interval = maxAge ?? snapshot.rateLimit?.cadenceMs ?? null
      if (pendingOperations.has(prKey(ref)) || interval === null || backingOff()) return snapshot
      if (snapshot.refreshedAt && Date.now() - snapshot.refreshedAt < interval) return snapshot
      if (detectable(snapshot, interval)) {
        yield* Effect.promise(() => detect(ref))
        return yield* get(ref)
      }
      return yield* refresh(ref)
    })
  }

  // Recent enough that a cheap change detection can stand in for a full read.
  function detectable(snapshot: PullRequestSnapshot, interval: number) {
    return (
      !!snapshot.data &&
      Date.now() - (snapshot.refreshedAt ?? 0) <
        Math.max(interval, 5 * 60_000 * cadenceMultiplier())
    )
  }

  // The cadence a cached snapshot has outlived since it was last read or checked, or null.
  function prefetchDue(cached: PullRequestSnapshot) {
    const interval = cadence(cached.data?.pull.state === 'closed', 'blurred', true)
    const checked = Math.max(cached.refreshedAt ?? 0, lastDetection.get(prKey(cached)) ?? 0)
    return interval !== null && Date.now() - checked >= interval ? interval : null
  }

  // Detects first, like refreshIfStale: an unchanged PR costs one state query, not a full read.
  function prefetch(ref: PullRequestRef) {
    return Effect.gen(function* () {
      const cached = yield* get(ref)
      const interval = prefetchDue(cached)
      if (interval === null) return cached
      if (detectable(cached, interval) && !(yield* Effect.promise(() => detect(ref))))
        return yield* get(ref)
      return (yield* Effect.promise(() => schedule(ref, 'prefetch'))) ?? cached
    })
  }

  // List warming bypasses the hover queue's cap, but shares its two-read concurrency limit.
  function prefetchList(tab: PullRequestListTab, arrivals: readonly PullRequestRef[] = []) {
    return Effect.gen(function* () {
      const list = yield* store.getPullRequestList(tab)
      const rows = (list.items ?? [])
        .filter((pull) => pull.state === 'open')
        .toSorted((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10)
      const due: { ref: PullRequestRef; priority: 'arrival' | 'prefetch'; detectFirst: boolean }[] =
        []
      const arrivalKeys = new Set(arrivals.map(prKey))
      const seen = new Set<string>()
      for (const ref of [...arrivals, ...rows]) {
        const key = prKey(ref)
        if (seen.has(key)) continue
        seen.add(key)
        const cached = yield* get(ref)
        const interval = prefetchDue(cached)
        if (interval !== null)
          due.push({
            ref,
            priority: arrivalKeys.has(key) ? 'arrival' : 'prefetch',
            detectFirst: detectable(cached, interval),
          })
      }
      // Detections started together share one query; only changed PRs pay for a full read.
      const changed = yield* Effect.promise(() =>
        Promise.all(due.map((row) => (row.detectFirst ? detect(row.ref) : Promise.resolve(true))))
      )
      const snapshots = yield* Effect.forEach(
        due,
        ({ ref, priority }, index) =>
          changed[index] ? Effect.promise(() => schedule(ref, priority, false)) : get(ref),
        { concurrency: 'unbounded' }
      )
      return snapshots.filter((snapshot) => snapshot !== undefined)
    })
  }

  // One cheap query notices change on every open linked PR; only changed ones pay for a full
  // read. Check runs don't bump updatedAt, so the rollup state is compared too. Closed and merged
  // links are left to a PR view's own 30-minute cadence. PR watchers keep it going, a minute
  // apart, while no window shows Jetty.
  function refreshChangedLinks(watching = false) {
    return Effect.gen(function* () {
      const hidden = hub.githubActivity() === 'hidden'
      if (
        (hidden && !watching) ||
        backingOff() ||
        Date.now() - linksPolledAt < (hidden ? 60_000 : 30_000) * cadenceMultiplier()
      )
        return
      const links = (yield* store.activePullRequestLinks()).filter((link) =>
        validPullRequestRef(link)
      )
      if (!links.length) return
      linksPolledAt = Date.now()
      yield* Effect.forEach(links, (link) => Effect.promise(() => detect(link)), {
        concurrency: 'unbounded',
        discard: true,
      })
    })
  }

  // Whether a PR changed beyond its checks, so it needs a full read.
  function changed(graph: Graph, data: PullRequestData) {
    return (
      string(graph.pull.updatedAt) !== data.pull.updated_at ||
      graph.headSha !== data.pull.head.sha ||
      string(graph.pull.baseRefOid) !== data.pull.base.sha
    )
  }

  // The checks query also carries what change detection compares, so it stands in for it, and
  // merge readiness, which checks finishing (or GitHub settling an UNKNOWN) changes without
  // touching updatedAt.
  function refreshChecks(refs: readonly PullRequestRef[]) {
    return Effect.gen(function* () {
      const due = refs.filter((ref) => {
        const key = prKey(ref)
        return !checking.has(key) && !jobs.has(key) && !pendingOperations.has(key)
      })
      if (!due.length) return
      const fetchedRevisions = due.map((ref) => {
        const key = prKey(ref)
        checking.add(key)
        lastChecks.set(key, Date.now())
        lastDetection.set(key, Date.now())
        return revision(key)
      })
      const graphs = yield* Effect.tryPromise({
        try: () => fetchGraphqlBatch(due, pullRequestChecksFields),
        catch: (error) => new StoreError('internal', String(error)),
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const ref of due) checking.delete(prKey(ref))
          })
        )
      )
      for (const [index, ref] of due.entries()) {
        const graph = graphs[index]
        const snapshot = yield* get(ref)
        if (!graph || graph instanceof GhFailure || !snapshot.data) continue
        if (changed(graph, snapshot.data)) {
          void schedule(ref, watches.has(prKey(ref)) ? 'visible' : 'prefetch')
          continue
        }
        const data = {
          ...snapshot.data,
          pull: {
            ...snapshot.data.pull,
            mergeable_state: mergeableState(graph.pull.mergeStateStatus),
          },
          mergeable: graph.pull.mergeable as PullRequestData['mergeable'],
          mergeStateStatus: string(graph.pull.mergeStateStatus, 'UNKNOWN'),
          checkRuns: mapCheckRuns(graph.checks),
          checkRollupState: graph.checkRollupState,
          checkRunsTotalCount: graph.checkRunsTotalCount,
          truncatedConnections: [
            ...(snapshot.data.truncatedConnections ?? []).filter((field) => field !== 'checkRuns'),
            ...graph.truncatedConnections.filter((field) => field === 'checkRuns'),
          ],
        }
        // Nothing but checks changed, so the stored PR is current again.
        const { error: _error, ...current } = snapshot
        yield* publish(ref, { ...current, status: 'ready', data }, fetchedRevisions[index]!)
      }
    })
  }

  // Patches rarely show a modified file's first lines, so once per head commit an open PR reads
  // the heads it's missing in the background, then marks the files that carry a banner.
  function markGeneratedHeads(ref: PullRequestRef, data: PullRequestData) {
    const key = prKey(ref)
    const sha = data.pull.head.sha
    if (cacheRead(headsRead, key) === sha) return
    cacheWrite(headsRead, key, sha)
    const fetchedRevision = revision(key)
    void Effect.runPromise(
      Effect.gen(function* () {
        const complete = yield* Effect.promise(() =>
          readHeads(ref.repo, sha, data.files, () => watches.has(key))
        )
        // Reads skipped once nobody watched, or while backing off, resume on a later poll.
        if (!complete && headsRead.get(key) === sha) headsRead.delete(key)
        const running = jobs.get(key)
        if (running) yield* Effect.promise(() => running.promise)
        const snapshot = yield* get(ref)
        const current = snapshot.data
        if (!current) return
        const files = current.files.map(markGenerated)
        if (files.every((file, index) => file === current.files[index])) return
        yield* publish(ref, { ...snapshot, data: { ...current, files } }, fetchedRevision)
      })
    ).catch((error: unknown) => console.warn(`[pr-heads] ${key} ${String(error)}`))
  }

  function detectChanges(refs: readonly PullRequestRef[]) {
    return Effect.gen(function* () {
      const graphs = yield* Effect.promise(() => fetchGraphqlBatch(refs, pullRequestStateFields))
      const checks: PullRequestRef[] = []
      const reads = new Set<string>()
      for (const [index, ref] of refs.entries()) {
        const graph = graphs[index]!
        const snapshot = yield* get(ref)
        if (graph instanceof GhFailure) continue
        if (!snapshot.data || changed(graph, snapshot.data)) {
          reads.add(prKey(ref))
          void schedule(ref, watches.has(prKey(ref)) ? 'visible' : 'prefetch')
        } else if (
          graph.checkRollupState !== snapshot.data.checkRollupState ||
          // GitHub settles mergeability lazily; asking again until it does surfaces conflicts.
          mergeUnknown(snapshot.data) ||
          // The checks read republishes it as current, clearing a failed full read's notice.
          snapshot.status !== 'ready'
        )
          checks.push(ref)
      }
      yield* refreshChecks(checks)
      return reads
    })
  }

  const queuedDetection = new Map<
    string,
    { ref: PullRequestRef; resolve: (changed: boolean) => void }
  >()
  let detectionQueued = false
  const detectionRequests = new Map<string, Promise<boolean>>()
  // Whether a state query found the PR changed, which queues its full read.
  function detect(ref: PullRequestRef) {
    const key = prKey(ref)
    const existing = detectionRequests.get(key)
    if (existing) return existing
    if (Date.now() - (lastDetection.get(key) ?? 0) < 5000) return Promise.resolve(false)
    lastDetection.set(key, Date.now())
    const promise = new Promise<boolean>((resolve) => {
      queuedDetection.set(prKey(ref), { ref, resolve })
      if (detectionQueued) return
      detectionQueued = true
      queueMicrotask(() => {
        detectionQueued = false
        const batch = [...queuedDetection.values()]
        queuedDetection.clear()
        void Effect.runPromise(detectChanges(batch.map((item) => item.ref))).then(
          (reads) => {
            for (const item of batch) item.resolve(reads.has(prKey(item.ref)))
          },
          (error: unknown) => {
            console.warn(`[pr-poll] ${String(error)}`)
            for (const item of batch) item.resolve(false)
          }
        )
      })
    }).finally(() => detectionRequests.delete(key))
    detectionRequests.set(key, promise)
    return promise
  }

  function poll(ref: PullRequestRef) {
    const key = prKey(ref)
    return Effect.gen(function* () {
      let snapshot = yield* get(ref)
      if (pendingOperations.has(key) || jobs.has(key) || backingOff()) return
      const interval = snapshot.rateLimit?.cadenceMs
      if (!interval) return
      const checksInterval = snapshot.rateLimit?.checksCadenceMs
      if (
        !snapshot.data ||
        Date.now() - (snapshot.refreshedAt ?? 0) >=
          Math.max(interval, 5 * 60_000 * cadenceMultiplier())
      ) {
        snapshot = yield* refresh(ref)
        lastDetection.set(key, Date.now())
      } else if (checksInterval) {
        const checkedAt = Math.max(lastChecks.get(key) ?? 0, snapshot.refreshedAt ?? 0)
        if (Date.now() - checkedAt >= checksInterval) yield* refreshChecks([ref])
      } else if (
        !detecting.has(key) &&
        Date.now() - (lastDetection.get(key) ?? snapshot.refreshedAt ?? 0) >= interval
      ) {
        detecting.add(key)
        yield* Effect.promise(() => detect(ref)).pipe(
          Effect.ensuring(Effect.sync(() => detecting.delete(key)))
        )
        snapshot = yield* get(ref)
      }
      if (snapshot.data) markGeneratedHeads(ref, snapshot.data)
    })
  }

  function write(
    ref: PullRequestRef,
    operation: NonNullable<PullRequestSnapshot['pendingOperation']>,
    optimistic: (data: PullRequestData) => PullRequestData,
    send: (data: PullRequestData) => Promise<unknown>,
    confirm: (data: PullRequestData, response: unknown) => PullRequestData = (data) => data,
    options: { refreshAfter?: boolean } = {}
  ) {
    const key = prKey(ref)
    const applied = Effect.gen(function* () {
      const initial = yield* get(ref)
      if (!initial.data?.pull.node_id) {
        const loaded = yield* refresh(ref)
        if (!loaded.data?.pull.node_id)
          return yield* Effect.fail(
            new StoreError('internal', loaded.error ?? 'Pull request is unavailable')
          )
      }
      const previous = yield* publication.withPermit(
        Effect.gen(function* () {
          const snapshot = yield* get(ref)
          if (!snapshot.data?.pull.node_id)
            return yield* Effect.fail(new StoreError('internal', 'Pull request is unavailable'))
          pendingOperations.set(key, operation)
          revisions.set(key, revision(key) + 1)
          return { ...snapshot, data: snapshot.data }
        })
      )
      function save(data: PullRequestData) {
        return publication.withPermit(
          Effect.gen(function* () {
            const snapshot = { ...previous, data }
            yield* store.savePullRequest(snapshot)
            hub.pushPullRequest(decorate(snapshot))
            for (const threadId of yield* store.threadsForPullRequest(ref.repo, ref.number)) {
              const thread = yield* store.requireThread(threadId)
              hub.pushChrome({ type: 'thread.upserted', thread })
            }
          })
        )
      }
      yield* Effect.gen(function* () {
        yield* save(optimistic(previous.data))
        const result = yield* Effect.tryPromise({
          try: () => send(previous.data),
          catch: writeError,
        }).pipe(Effect.tapError(() => save(previous.data)))
        const current = yield* get(ref)
        if (current.data) yield* save(confirm(current.data, result))
      }).pipe(
        Effect.ensuring(
          publication
            .withPermit(
              Effect.gen(function* () {
                pendingOperations.delete(key)
                revisions.set(key, revision(key) + 1)
                hub.pushPullRequest(yield* get(ref))
              })
            )
            .pipe(Effect.catch((error) => Effect.logWarning(error)))
        )
      )
    })
    return Effect.suspend(() => {
      queuedWrites.set(key, (queuedWrites.get(key) ?? 0) + 1)
      if (options.refreshAfter !== false) writesNeedRefresh.add(key)
      return writing.withPermit(applied).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (exit._tag === 'Failure') writesNeedRefresh.add(key)
            const queued = queuedWrites.get(key)! - 1
            if (queued) {
              queuedWrites.set(key, queued)
              return
            }
            queuedWrites.delete(key)
            const running = jobs.get(key)
            if (running) yield* Effect.promise(() => running.promise)
            if (writesNeedRefresh.delete(key))
              yield* refresh(ref).pipe(Effect.catch(() => Effect.void))
          })
        ),
        Effect.andThen(get(ref))
      )
    }).pipe(Effect.uninterruptible)
  }

  function updateTitle(ref: PullRequestRef, title: string) {
    if (!title.trim() || title.length > 256)
      return Effect.fail(
        new StoreError('invalid_params', 'A pull request title must contain 1–256 characters')
      )
    return write(
      ref,
      'title',
      (data) => ({ ...data, pull: { ...data.pull, title } }),
      () =>
        githubWrite('PATCH', `repos/${ref.repo}/pulls/${ref.number}`, JSON.stringify({ title })),
      (data, result) => ({
        ...data,
        pull: {
          ...data.pull,
          title: string(record(result).title, title),
          updated_at: string(record(result).updated_at, data.pull.updated_at),
        },
      }),
      { refreshAfter: false }
    )
  }

  function updateBody(ref: PullRequestRef, body: string) {
    if (body.length > 65_536)
      return Effect.fail(new StoreError('invalid_params', 'Pull request body is too long'))
    return write(
      ref,
      'body',
      (data) => ({ ...data, pull: { ...data.pull, body } }),
      () => githubWrite('PATCH', `repos/${ref.repo}/pulls/${ref.number}`, JSON.stringify({ body })),
      (data, result) => ({
        ...data,
        pull: {
          ...data.pull,
          body: string(record(result).body, body),
          updated_at: string(record(result).updated_at, data.pull.updated_at),
        },
      })
    )
  }

  async function mutate(name: string, input: Record<string, unknown>, fields: string) {
    const response = record(
      await githubWrite(
        'POST',
        'graphql',
        JSON.stringify({
          query: `mutation($input:${name[0]!.toUpperCase()}${name.slice(1)}Input!) {
      ${name}(input:$input) { ${fields} }
    }`,
          variables: { input },
        })
      )
    )
    if (Array.isArray(response.errors)) {
      const errors = response.errors.map(record)
      if (errors.some((error) => error.type === 'FORBIDDEN' || error.type === 'NOT_FOUND'))
        throw writeError(new GhFailure('not_found', '', 403))
      throw new StoreError(
        'invalid_params',
        errors.map((error) => string(error.message)).join('; ') || 'GitHub rejected this operation'
      )
    }
    const result = record(record(response.data)[name])
    if (!Object.keys(result).length)
      throw new StoreError('internal', 'GitHub returned no mutation result')
    return result
  }

  function setState(ref: PullRequestRef, state: 'open' | 'draft' | 'closed') {
    return write(
      ref,
      'state',
      (data) => ({
        ...data,
        pull: {
          ...data.pull,
          state: state === 'closed' ? 'closed' : 'open',
          draft: state === 'closed' ? data.pull.draft : state === 'draft',
        },
      }),
      async () => {
        const response = record(
          await graphql(pullRequestGraphqlQuery([ref], 'id state isDraft merged'))
        )
        if (response.errors)
          throw new GhFailure('unavailable', 'GitHub could not read pull request state')
        const pull = record(record(record(response.data).p0).pullRequest)
        if (!pull.id)
          throw new GhFailure('not_found', 'Pull request not found or access denied', 404)
        if (pull.merged === true)
          throw new StoreError('invalid_params', 'A merged pull request cannot change state')
        if (state === 'closed' || pull.state === 'CLOSED') {
          const result = record(
            await githubWrite(
              'PATCH',
              `repos/${ref.repo}/pulls/${ref.number}`,
              JSON.stringify({ state: state === 'closed' ? 'closed' : 'open' })
            )
          )
          if (state === 'closed') return result
          pull.isDraft = result.draft
        }
        const draft = state === 'draft'
        if (pull.isDraft !== draft)
          await mutate(
            draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview',
            { pullRequestId: pull.id },
            'pullRequest { id state isDraft updatedAt }'
          )
        return null
      }
    )
  }

  function comment(ref: PullRequestRef, body: string) {
    if (!body.trim() || body.length > 65_536)
      return Effect.fail(
        new StoreError('invalid_params', 'A comment must contain 1–65536 characters')
      )
    return write(
      ref,
      'comment',
      (data) => data,
      async (data) =>
        mutate(
          'addComment',
          { subjectId: data.pull.node_id, body },
          `subject { ... on PullRequest { updatedAt } }
          commentEdge { node { databaseId body createdAt url author { ${actorFields} } } }`
        ),
      (data, response) => {
        const comment = record(record(record(response).commentEdge).node)
        const entry = {
          id: Number(comment.databaseId),
          user: user(comment.author),
          body: string(comment.body),
          created_at: string(comment.createdAt),
          html_url: string(comment.url),
        }
        return {
          ...data,
          issueComments: [...(data.issueComments ?? []), entry],
          pull: {
            ...data.pull,
            comments: data.pull.comments + 1,
            updated_at: string(record(record(response).subject).updatedAt, data.pull.updated_at),
          },
        }
      },
      { refreshAfter: false }
    )
  }

  function reply(ref: PullRequestRef, commentId: number, body: string) {
    if (!Number.isSafeInteger(commentId) || commentId <= 0 || !body.trim() || body.length > 65_536)
      return Effect.fail(new StoreError('invalid_params', 'Invalid review reply'))
    return write(
      ref,
      'comment',
      (data) => data,
      (data) => {
        const root = data.reviewComments.find((entry) => entry.id === commentId)
        if (!root || root.in_reply_to_id)
          throw new StoreError(
            'invalid_params',
            'Reply requires the root comment of this pull request thread'
          )
        return githubWrite(
          'POST',
          `repos/${ref.repo}/pulls/${ref.number}/comments/${commentId}/replies`,
          JSON.stringify({ body })
        )
      },
      (data, response) => {
        const comment = record(response)
        const root = data.reviewComments.find((entry) => entry.id === commentId)
        const author = user(comment.user)
        const named =
          author.login === data.viewer?.login
            ? data.viewer
            : data.reviewers?.find((entry) => entry.login === author.login)
        const entry = {
          ...root,
          id: Number(comment.id),
          user: { ...author, ...(named?.name ? { name: named.name } : {}) },
          body: string(comment.body),
          path: string(comment.path),
          line: typeof comment.line === 'number' ? comment.line : null,
          diff_hunk: string(comment.diff_hunk),
          created_at: string(comment.created_at),
          html_url: string(comment.html_url),
          in_reply_to_id: commentId,
          pull_request_review_id: Number(comment.pull_request_review_id) || 0,
        }
        return {
          ...data,
          reviewComments: [...data.reviewComments, entry],
          pull: { ...data.pull, review_comments: data.pull.review_comments + 1 },
        }
      }
    )
  }

  function resolveThread(ref: PullRequestRef, threadId: string, resolved: boolean) {
    if (!threadId) return Effect.fail(new StoreError('invalid_params', 'Invalid review thread'))
    function patch(data: PullRequestData, state: boolean) {
      return {
        ...data,
        reviewComments: data.reviewComments.map((comment) =>
          comment.thread_id === threadId ? { ...comment, resolved: state } : comment
        ),
      }
    }
    return write(
      ref,
      'thread',
      (data) => patch(data, resolved),
      async (data) => {
        if (!data.reviewComments.some((comment) => comment.thread_id === threadId))
          throw new StoreError(
            'invalid_params',
            'Review thread does not belong to this pull request'
          )
        return mutate(
          resolved ? 'resolveReviewThread' : 'unresolveReviewThread',
          { threadId },
          'thread { id isResolved }'
        )
      },
      (data, response) => patch(data, record(record(response).thread).isResolved === true),
      { refreshAfter: false }
    )
  }

  function setViewed(ref: PullRequestRef, path: string, viewed: boolean) {
    if (!path || path.includes('\0'))
      return Effect.fail(new StoreError('invalid_params', 'Invalid file path'))
    function patch(data: PullRequestData) {
      return {
        ...data,
        files: data.files.map((file) =>
          file.filename === path
            ? { ...file, viewed: viewed ? ('VIEWED' as const) : ('UNVIEWED' as const) }
            : file
        ),
      }
    }
    return write(
      ref,
      'viewed',
      patch,
      async (data) => {
        if (!data.files.some((file) => file.filename === path))
          throw new StoreError('invalid_params', 'File does not belong to this pull request')
        return mutate(
          viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed',
          { pullRequestId: data.pull.node_id, path },
          'pullRequest { id }'
        )
      },
      patch,
      { refreshAfter: false }
    )
  }

  function merge(
    ref: PullRequestRef,
    sha: string,
    mergeMethod: 'squash' | 'merge' | 'rebase' = 'squash'
  ) {
    if (!/^[a-f0-9]{40,64}$/i.test(sha))
      return Effect.fail(new StoreError('invalid_params', 'A merge requires the current head SHA'))
    return write(
      ref,
      'merge',
      (data) => data,
      async () => {
        const result = record(
          await githubWrite(
            'PUT',
            `repos/${ref.repo}/pulls/${ref.number}/merge`,
            JSON.stringify({ merge_method: mergeMethod, sha })
          )
        )
        if (result.merged !== true)
          throw new StoreError(
            'invalid_params',
            string(result.message, 'GitHub did not merge this pull request')
          )
        return result
      },
      (data) => ({
        ...data,
        pull: { ...data.pull, state: 'closed', merged: true, merged_at: new Date().toISOString() },
      })
    )
  }

  function setReviewRequest(
    ref: PullRequestRef,
    login: string,
    requested: boolean,
    kind: 'user' | 'bot' | 'team' = 'user'
  ) {
    if (kind === 'team' ? !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(login) : !validLogin(login))
      return Effect.fail(
        new StoreError(
          'invalid_params',
          kind === 'team' ? 'Invalid GitHub team slug' : 'Invalid GitHub login'
        )
      )
    const organization = ref.repo.split('/')[0]!
    const identity = kind === 'team' ? `${organization}/${login}` : canonicalLogin(login)
    const others = (entries: readonly PullRequestReviewer[] = []) =>
      entries.filter((entry) => entry.login.toLowerCase() !== identity.toLowerCase())
    return write(
      ref,
      'reviews',
      (data) => {
        const existing = data.reviewers?.find(
          (entry) => entry.login.toLowerCase() === identity.toLowerCase()
        )
        const reviewer: PullRequestReviewer = {
          login: identity,
          avatar_url: '',
          html_url: '',
          ...existing,
          kind: identity === 'Copilot' ? 'bot' : kind,
          ...(kind === 'team' ? { slug: login, organization } : {}),
          requested,
          asCodeOwner: existing?.asCodeOwner ?? false,
          latestReviewState: existing?.latestReviewState ?? null,
          state: requested ? 'AWAITING' : (existing?.latestReviewState ?? null),
        }
        const reviewRequests = [...others(data.reviewRequests), ...(requested ? [reviewer] : [])]
        const { requestedUsers, requestedTeams } = requestedReviewers(reviewRequests)
        return {
          ...data,
          reviewRequests,
          reviewers: [...others(data.reviewers), reviewer],
          pull: { ...data.pull, requested_reviewers: requestedUsers },
          requestedTeams,
        }
      },
      () => sendReviewRequest(ref, login, requested, kind)
    )
  }

  const candidateTtl = 5 * 60_000
  const candidates = new Map<
    string,
    { at: number; promise: ReturnType<typeof fetchReviewerCandidates> }
  >()

  function reviewerCandidates(repo: string, search: string) {
    const key = `${repo}\n${search}`
    const cached = candidates.get(key)
    if (cached && Date.now() - cached.at < candidateTtl) return cached.promise
    const promise = fetchReviewerCandidates(repo, search)
    candidates.set(key, { at: Date.now(), promise })
    if (candidates.size > 64) candidates.delete(candidates.keys().next().value!)
    promise.catch(() => candidates.delete(key))
    return promise
  }

  return {
    observe(next: PullRequestObserver) {
      observer = next
    },
    get,
    refresh,
    prefetch,
    prefetchList,
    refreshIfStale,
    refreshChangedLinks,
    setReviewRequest,
    reviewerCandidates,
    watch,
    poll,
    updateTitle,
    updateBody,
    setState,
    comment,
    reply,
    resolveThread,
    setViewed,
    merge,
  }
}

const listLimit = 100
const recentDays = 14

function recentSince() {
  return new Date(Date.now() - recentDays * 86_400_000).toISOString().slice(0, 10)
}

function listSearches(tab: PullRequestListTab): string[] {
  const open = 'is:pr is:open archived:false sort:updated-desc'
  if (tab === 'for-you') return [`${open} review-requested:@me`, `${open} assignee:@me`]
  // GitHub's search index can miss `closed:` dates (it drops some freshly closed PRs), so
  // search by update time and filter on the PR's own closedAt.
  return [
    `${open} author:@me`,
    `is:pr is:closed archived:false author:@me updated:>=${recentSince()} sort:updated-desc`,
  ]
}

function listItem(value: unknown): PullRequestListItem | null {
  const node = record(value)
  const repo = string(record(node.repository).nameWithOwner).toLowerCase()
  const number = Number(node.number)
  if (!repo || !Number.isSafeInteger(number)) return null
  const rollup = record(
    record(record((record(node.commits).nodes as unknown[] | undefined)?.[0]).commit)
      .statusCheckRollup
  )
  const checks = rollupChecks[string(rollup.state)]
  const { login, avatar_url, name } = user(node.author)
  return {
    repo,
    number,
    title: string(node.title),
    url: string(node.url),
    state: node.merged
      ? 'merged'
      : node.state === 'CLOSED'
        ? 'closed'
        : node.isDraft
          ? 'draft'
          : 'open',
    ...(checks ? { checks } : {}),
    author: { login, avatar_url, ...(name ? { name } : {}) },
    additions: Number(node.additions) || 0,
    deletions: Number(node.deletions) || 0,
    reviewDecision: (node.reviewDecision ?? null) as PullRequestListItem['reviewDecision'],
    mergeable: node.mergeable as PullRequestListItem['mergeable'],
    mergeStateStatus: string(node.mergeStateStatus),
    updatedAt: Date.parse(string(node.updatedAt)) || 0,
  }
}

export function pullRequestListGraphqlQuery(tabs: readonly PullRequestListTab[]) {
  const searches = tabs.flatMap(listSearches)
  const fields = `issueCount nodes { ... on PullRequest {
    id number title url isDraft state merged updatedAt closedAt repository { nameWithOwner }
    author { ${actorFields} }
    additions deletions
    reviewDecision mergeable mergeStateStatus
    commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
  } }`
  return {
    searches,
    query: `query(${searches.map((_, index) => `$q${index}:String!`).join(',')}) {
    rateLimit { cost remaining resetAt }
    ${searches.map((_, index) => `s${index}: search(query:$q${index},type:ISSUE,first:${listLimit}) { ${fields} }`).join('\n')}
  }`,
  }
}

export function mapPullRequestList(value: unknown, tabIndex = 0) {
  const data = record(record(value).data)
  const since = Date.parse(recentSince())
  const found = new Map<string, PullRequestListItem>()
  let truncated = false
  for (let index = tabIndex * 2; index < tabIndex * 2 + 2; index++) {
    const result = record(data[`s${index}`])
    const values = nodes(result)
    if (Number(result.issueCount) > values.length) truncated = true
    for (const node of values) {
      const closedAt = Date.parse(string(record(node).closedAt))
      if (closedAt < since) continue
      const item = listItem(node)
      if (item) found.set(`${item.repo}#${item.number}`, item)
    }
  }
  return {
    items: [...found.values()].sort((left, right) => right.updatedAt - left.updatedAt),
    truncated,
  }
}

function listSignature(value: unknown, tabIndex = 0) {
  const data = record(record(value).data)
  const searches = []
  const since = Date.parse(recentSince())
  for (let index = tabIndex * 2; index < tabIndex * 2 + 2; index++) {
    const result = record(data[`s${index}`])
    searches.push({
      count: result.issueCount,
      items: nodes(result)
        .filter((node) => !(Date.parse(string(record(node).closedAt)) < since))
        .map((value) => {
          const node = record(value)
          return [
            node.id,
            node.number,
            record(node.repository).nameWithOwner,
            node.updatedAt,
            node.closedAt,
            node.state,
            node.isDraft,
            node.reviewDecision,
            node.mergeStateStatus,
            node.mergeable,
            record(record(record(nodes(node.commits)[0]).commit).statusCheckRollup).state ?? null,
          ]
        })
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    })
  }
  return JSON.stringify(searches)
}

async function probePullRequestLists(tabs: readonly PullRequestListTab[], ids: readonly string[]) {
  const searches = tabs.flatMap(listSearches)
  // New identities force a full read; only cached PRs need a checks connection.
  // nodes(ids:) avoids multiplying that connection by each search's requested size.
  const response = await graphql(`query {
    rateLimit { cost remaining resetAt }
    ${searches
      .map(
        (search, index) => `s${index}: search(
      query:${JSON.stringify(search)},type:ISSUE,first:${listLimit}
    ) {
      issueCount nodes { ... on PullRequest {
        id number repository { nameWithOwner } updatedAt closedAt state isDraft
        reviewDecision mergeStateStatus mergeable
      } }
    }`
      )
      .join('\n')}
    ${Array.from(
      { length: Math.ceil(ids.length / 100) },
      (_, index) => `c${index}: nodes(
      ids:${JSON.stringify(ids.slice(index * 100, (index + 1) * 100))}
    ) { ... on PullRequest {
      id commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
    } }`
    ).join('\n')}

  }`)
  const data = record(record(response).data)
  const commits = new Map<string, unknown>()
  for (let index = 0; index < Math.ceil(ids.length / 100); index++) {
    const pulls = data[`c${index}`]
    if (!Array.isArray(pulls)) throw new Error('GitHub list probe is incomplete')
    for (const value of pulls) {
      const pull = record(value)
      if (pull.id && pull.commits) commits.set(string(pull.id), pull.commits)
    }
  }
  const known = new Set(ids)
  for (const [index] of searches.entries()) {
    const result = record(data[`s${index}`])
    if (!Array.isArray(result.nodes)) throw new Error('GitHub list probe is incomplete')
    for (const value of nodes(result)) {
      const node = record(value)
      node.commits = commits.get(string(node.id))
      if (known.has(string(node.id)) && !node.commits)
        throw new Error('GitHub list probe is incomplete')
    }
  }
  return new Map(tabs.map((tab, index) => [tab, listSignature(response, index)]))
}

async function fetchPullRequestLists(tabs: readonly PullRequestListTab[]) {
  const { searches, query } = pullRequestListGraphqlQuery(tabs)
  const response = record(
    await graphql(query, Object.fromEntries(searches.map((search, index) => [`q${index}`, search])))
  )
  // Partial data drops rows (a search or PR nulled by the error), so keep the last good list,
  // unless every error is lost access: those rows never come back.
  const errors = Array.isArray(response.errors) ? response.errors.map(record) : []
  const data = record(response.data)
  if (
    errors.some((error) => !['FORBIDDEN', 'NOT_FOUND'].includes(string(error.type))) ||
    searches.some((_, index) => !Array.isArray(record(data[`s${index}`]).nodes))
  )
    throw new GhFailure(
      'unavailable',
      string(errors[0]?.message) || 'GitHub returned part of the pull request list'
    )
  return tabs.map((tab, index) => ({
    signature: listSignature(response, index),
    ids: [index * 2, index * 2 + 1].flatMap((search) =>
      nodes(record(record(response).data)[`s${search}`]).map((node) => string(record(node).id))
    ),
    list: {
      tab,
      status: 'ready',
      ...mapPullRequestList(response, index),
      refreshedAt: Date.now(),
    } satisfies PullRequestList,
  }))
}

function failedList(tab: PullRequestListTab, error: unknown): PullRequestList {
  return {
    tab,
    status:
      error instanceof GhFailure && error.kind === 'rate_limited' ? 'rate_limited' : 'unavailable',
    error: error instanceof GhFailure ? error.message : 'GitHub API is unavailable',
    refreshedAt: Date.now(),
  }
}

export function createPullRequestLists(
  store: Store,
  hub: Hub,
  pulls: ReturnType<typeof createPullRequests>,
  scope: Scope.Scope
) {
  const signatures = new Map<PullRequestListTab, string>()
  const checksIds = new Map<PullRequestListTab, string[]>()
  const watches = createWatches<PullRequestListTab>(hub.clientActivity)
  const probed = new Map<PullRequestListTab, { at: number; signature: string }>()
  const probing = new Map<PullRequestListTab, Promise<string>>()
  const queuedProbes = new Map<
    PullRequestListTab,
    { resolve: (signature: string) => void; reject: (error: unknown) => void }
  >()

  // Tabs probed in the same tick share one query.
  function probe(tab: PullRequestListTab, maxAge: number) {
    const pending = probing.get(tab)
    if (pending) return pending
    const last = probed.get(tab)
    if (last && Date.now() - last.at < maxAge * cadenceMultiplier())
      return Promise.resolve(last.signature)
    const promise = new Promise<string>((resolve, reject) =>
      queuedProbes.set(tab, { resolve, reject })
    )
    probing.set(tab, promise)
    if (queuedProbes.size === 1)
      queueMicrotask(() => {
        const batch = [...queuedProbes]
        queuedProbes.clear()
        const tabs = batch.map(([tab]) => tab)
        void probePullRequestLists(tabs, [
          ...new Set(tabs.flatMap((tab) => checksIds.get(tab) ?? [])),
        ]).then(
          (result) => {
            for (const [tab, { resolve }] of batch) {
              probing.delete(tab)
              probed.set(tab, { at: Date.now(), signature: result.get(tab)! })
              resolve(result.get(tab)!)
            }
          },
          (error) => {
            for (const [tab, { reject }] of batch) {
              probing.delete(tab)
              reject(error)
            }
          }
        )
      })
    return promise
  }

  const inFlight = new Map<PullRequestListTab, Promise<PullRequestList>>()

  const publication = {
    'for-you': Semaphore.makeUnsafe(1),
    created: Semaphore.makeUnsafe(1),
  }
  const queued = new Map<PullRequestListTab, (list: PullRequestList) => void>()
  let flushQueued = false

  // A tab polls only while a list shows it.
  function listInterval(state: GitHubActivity) {
    return state === 'hidden' || backingOff() ? null : state === 'focused' ? 30_000 : 120_000
  }

  function decorate(list: PullRequestList, state = watches.activity(list.tab)): PullRequestList {
    const interval = listInterval(state)
    return {
      ...list,
      rateLimit: githubRateLimitHealth(interval && interval * cadenceMultiplier()),
    }
  }

  // A list that never loaded can't while GitHub backs off, so it says why instead of loading.
  function get(tab: PullRequestListTab) {
    return store
      .getPullRequestList(tab)
      .pipe(
        Effect.map((list) =>
          decorate(
            list.status === 'loading' && backingOff() ? failedList(tab, backoffFailure()) : list
          )
        )
      )
  }

  function load(tab: PullRequestListTab) {
    const existing = inFlight.get(tab)
    if (existing) return existing
    const promise = new Promise<PullRequestList>((resolve) => queued.set(tab, resolve))
    inFlight.set(tab, promise)
    if (!flushQueued) {
      flushQueued = true
      queueMicrotask(() => {
        flushQueued = false
        const batch = [...queued]
        queued.clear()
        void fetchPullRequestLists(batch.map(([tab]) => tab)).then(
          (lists) => {
            for (const [index, [tab, resolve]] of batch.entries()) {
              inFlight.delete(tab)
              const result = lists[index]!
              signatures.set(tab, result.signature)
              checksIds.set(tab, result.ids)
              resolve(result.list)
            }
          },
          (error) => {
            for (const [tab, resolve] of batch) {
              inFlight.delete(tab)
              resolve(failedList(tab, error))
            }
          }
        )
      })
    }
    return promise
  }

  function refresh(tab: PullRequestListTab, maxAge = 0) {
    return Effect.gen(function* () {
      const cached = yield* get(tab)
      if (backingOff()) return cached
      if (cached.refreshedAt && Date.now() - cached.refreshedAt < maxAge * cadenceMultiplier())
        return cached
      const loaded = yield* Effect.tryPromise({
        try: () => probe(tab, maxAge),
        catch: (error) => error,
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(failedList(tab, error)),
          onSuccess: (signature) => {
            const unchanged =
              cached.status === 'ready' && cached.items && signatures.get(tab) === signature
            return unchanged
              ? Effect.succeed({ ...cached, refreshedAt: Date.now() })
              : Effect.promise(() => load(tab))
          },
        })
      )
      yield* store.savePullRequestList(loaded)
      // The stored list keeps the last good items when this read failed.
      const list = yield* store.getPullRequestList(tab)
      const decorated = decorate(list)
      if (list.status === 'ready') {
        const previous = new Set((cached.items ?? []).map(prKey))
        const arrivals = cached.items
          ? (list.items ?? []).filter((item) => !previous.has(prKey(item)))
          : []
        if (!cached.items || arrivals.length)
          yield* pulls.prefetchList(tab, arrivals).pipe(
            Effect.catch(() => Effect.void),
            Effect.forkIn(scope)
          )
      }
      hub.pushPullRequestList(decorated)
      return decorated
    }).pipe(publication[tab].withPermit)
  }

  // Every focus change runs this, so it catches up only lists older than the blurred cadence.
  function refreshOnArrival() {
    return Effect.forEach(['for-you', 'created'] as const, (tab) => refresh(tab, 120_000), {
      concurrency: 'unbounded',
      discard: true,
    })
  }

  function refreshIfStale(tab: PullRequestListTab) {
    const interval = listInterval(watches.activity(tab))
    return interval ? refresh(tab, interval) : get(tab)
  }

  function poll() {
    return Effect.forEach(watches.keys(), refreshIfStale, {
      concurrency: 'unbounded',
      discard: true,
    })
  }

  return {
    get,
    refresh,
    refreshOnArrival,
    refreshIfStale,
    watch: watches.watch,
    poll,
  }
}

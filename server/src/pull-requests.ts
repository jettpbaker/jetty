/*
 * One bounded GraphQL selection per PR refresh; concurrent jobs share aliased batches
 * (up to 5 PRs). REST history/files retain ETags; authenticated 304s are free.
 * Focused views refresh every 30s, blurred views every 2m, hidden clients never, closed or
 * merged PRs every 30m. While checks run, a checks-only query adds 10s focused / 30s blurred.
 * Linked PRs outside the view share one cheap query every 30s reading updatedAt and the
 * check rollup; only changed PRs pay for a full refresh. Writes publish cached state first
 * and refresh after confirmation. Below 500 GraphQL or REST points, cadence slows 4x;
 * exhaustion waits for reset. Secondary limits honour Retry-After, else exponential backoff
 * from 60s (capped at 15m). All limit/cadence changes are logged. Connections are bounded
 * at 100; truncation is explicit in the snapshot rather than paginating on every poll.
 */
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

import { PullRequestData } from '@jetty/shared/pull-request'
import { Effect, Schema, Scope, Semaphore } from 'effect'

import type { Hub } from './hub'
import type { PullRequestReference } from './pull-request-graphql'
import type { Store } from './store'

import {
  canonicalLogin,
  checkRollupFields,
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
    readonly status?: number
  ) {
    super(message)
  }
}

async function gh(args: string[], input?: string) {
  const bin = Bun.which('gh')
  if (!bin) throw new GhFailure('unavailable', 'GitHub CLI is not installed')
  try {
    const child = Bun.spawn([bin, ...args], {
      stdin: input === undefined ? 'ignore' : new Blob([input]),
      stdout: 'pipe',
      stderr: 'pipe',
      signal: AbortSignal.timeout(20000),
    })
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { out, detail: err.trim(), code }
  } catch {
    throw new GhFailure('unavailable', 'GitHub API is unavailable')
  }
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

export function checkBackoff() {
  if (backingOff())
    throw new GhFailure(
      'rate_limited',
      `GitHub rate limit reached; retry after ${new Date(rateHealth.backoffUntil!).toISOString()}`
    )
}

async function requestApi(args: string[], body?: string): Promise<unknown> {
  checkBackoff()
  const restGet = args.length === 1 && args[0] !== 'graphql' && body === undefined
  const key = args[0]!
  const cached = restGet ? restCache.get(key) : undefined
  const { out, detail, code } = await gh(
    [
      'api',
      '--hostname',
      'github.com',
      '--include',
      ...args,
      ...(cached ? ['-H', `If-None-Match: ${cached.etag}`] : []),
      ...(body === undefined ? [] : ['--input', '-']),
    ],
    body
  )
  const split = out.search(/\r?\n\r?\n/)
  const headerText = split >= 0 ? out.slice(0, split) : ''
  const raw = split >= 0 ? out.slice(split).trim() : out
  const status = Number(headerText.match(/^HTTP\/\S+\s+(\d+)/)?.[1]) || (code === 0 ? 200 : 0)
  const headers = new Headers()
  for (const line of headerText.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  let value: unknown = null
  try {
    if (raw) value = JSON.parse(raw)
  } catch {
    if (code === 0 && status !== 304)
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
  const partialGraph =
    args.includes('graphql') &&
    Boolean(record(value).data) &&
    errors &&
    status < 400 &&
    !/rate limit|abuse detection/i.test(message)
  if (!partialGraph && (code !== 0 || status >= 400 || errors)) {
    if (
      status === 429 ||
      (status === 403 && backingOff()) ||
      /rate limit|abuse detection/i.test(message)
    )
      throw new GhFailure('rate_limited', message || 'GitHub rate limit reached', status)
    if (status === 404)
      throw new GhFailure('not_found', 'Pull request not found or access denied', status)
    throw new GhFailure('unavailable', message || 'GitHub API is unavailable', status)
  }
  if (restGet && headers.get('etag')) {
    restCache.set(key, { etag: headers.get('etag')!, value })
    if (restCache.size > 512) restCache.delete(restCache.keys().next().value!)
  }
  return value
}

export async function ghApi(...args: string[]): Promise<unknown> {
  const key = JSON.stringify(args)
  const existing = apiInFlight.get(key)
  if (existing) return existing
  const promise = requestApi(args)
  apiInFlight.set(key, promise)
  try {
    return await promise
  } finally {
    apiInFlight.delete(key)
  }
}

type DiffContents = string | null | { unavailable: 'tooLarge' | 'binary' }

const maxDiffContentsBytes = 1024 * 1024
const maxCachedDiffContents = 64
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
    response = record(await ghApi(`repos/${repo}/contents/${encodedPath}?ref=${sha}`))
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
  const existing = diffContentsCache.get(key)
  if (existing) return existing
  const pending = fetchDiffContents(repo, sha, path)
  diffContentsCache.set(key, pending)
  if (diffContentsCache.size > maxCachedDiffContents)
    diffContentsCache.delete(diffContentsCache.keys().next().value!)
  pending.catch(() => {
    if (diffContentsCache.get(key) === pending) diffContentsCache.delete(key)
  })
  return pending
}

function cachedMergeBase(repo: string, baseSha: string, headSha: string) {
  const key = `${repo}\0${baseSha}\0${headSha}`
  const existing = mergeBaseCache.get(key)
  if (existing) return existing
  const pending = ghApi(`repos/${repo}/compare/${baseSha}...${headSha}?per_page=1`).then(
    (response) => {
      const sha = string(record(record(response).merge_base_commit).sha)
      if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error('GitHub merge base unavailable')
      return sha
    }
  )
  mergeBaseCache.set(key, pending)
  if (mergeBaseCache.size > 64) mergeBaseCache.delete(mergeBaseCache.keys().next().value!)
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
  if (before === null || after === null) return { unavailable: 'missing' as const }
  return { before, after }
}

type Graph = Exclude<Awaited<ReturnType<typeof fetchGraphqlBatch>>[number], GhFailure>

async function fetchGraphqlBatch(
  refs: readonly (PullRequestRef & {
    headSha?: string
    references?: readonly PullRequestReference[]
  })[],
  fields = pullRequestGraphqlFields
) {
  const response = record(
    await ghApi('graphql', '-f', `query=${pullRequestGraphqlQuery(refs, fields)}`)
  )
  const data = record(response.data)
  const errors = Array.isArray(response.errors) ? response.errors.map(record) : []
  return refs.map((ref, index) => {
    const alias = `p${index}`
    const failed = errors.filter((error) => Array.isArray(error.path) && error.path[0] === alias)
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
    const graph = mapPullRequestGraphql(value)
    const comparison = record(record(graph.pull.baseRef).compare)
    const behindBy = comparison.behindBy
    return {
      ...graph,
      referenceTargets: ref.references ?? [],
      references: mapPullRequestReferences(data, ref.references ?? [], index),
      behindBy:
        record(comparison.headTarget).oid === graph.pull.headRefOid && typeof behindBy === 'number'
          ? behindBy
          : null,
    }
  })
}

// The last raw `pullRequest` read per PR and query shape. When GitHub answers with errors on some
// fields, those fields keep their previous value instead of reading as empty; when an error nulls
// the whole PR, the previous read stands in for it.
const lastPulls = new Map<string, Record<string, unknown>>()

function keepFailedFields(
  key: string,
  fields: string,
  value: unknown,
  paths: readonly unknown[][]
) {
  const previous = lastPulls.get(`${key}\0${fields}`)
  const pull = value ? { ...record(value) } : paths.length ? previous : undefined
  if (!pull) return undefined
  if (value && previous)
    for (const path of paths) {
      const field = path[2]
      // Checks read for an older head would pass for the new one, so they only carry over unmoved.
      if (field === 'commits' && 'headRefOid' in pull && headOid(previous) !== pull.headRefOid)
        continue
      if (typeof field === 'string' && field in previous) pull[field] = previous[field]
    }
  if (paths.length)
    console.warn(
      `[pr-fetch] ${key} kept previous ${paths.map((path) => path.slice(2).join('.')).join(', ')}`
    )
  if (lastPulls.size >= 500 && !previous) lastPulls.clear()
  lastPulls.set(`${key}\0${fields}`, pull)
  return pull
}

function headOid(pull: Record<string, unknown>) {
  return record(record(nodes(pull.commits)[0]).commit).oid
}

async function ghPages(path: string): Promise<unknown[]> {
  const items: unknown[] = []
  for (let page = 1; page <= 5; page++) {
    const result = await ghApi(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    if (!Array.isArray(result)) return items
    items.push(...result)
    if (result.length < 100) break
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
      name: workflow ? `${workflow} / ${string(check.name)}` : string(check.name),
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

async function fetchPullRequest(ref: PullRequestRef, first: Graph): Promise<PullRequestData> {
  const base = `repos/${ref.repo}`
  const pull = (await ghApi(`${base}/pulls/${ref.number}`)) as Record<string, unknown>
  const headSha = string(record(pull.head).sha)
  // A push between the two reads would pair the new head with the old head's checks and
  // mergeability, so the GraphQL half is read once more at the new head.
  const retried =
    first.pull.headRefOid === headSha
      ? first
      : (
          await fetchGraphqlBatch([{ ...ref, headSha, references: first.referenceTargets }]).catch(
            () => []
          )
        )[0]
  const graph = retried && !(retried instanceof GhFailure) ? retried : first
  const headMoved = graph.pull.headRefOid !== headSha
  const [reviews, reviewComments, commits, files, repo] = await Promise.all([
    ghPages(`${base}/pulls/${ref.number}/reviews`),
    ghPages(`${base}/pulls/${ref.number}/comments`),
    ghPages(`${base}/pulls/${ref.number}/commits`),
    ghPages(`${base}/pulls/${ref.number}/files`),
    ghApi(base),
  ])
  const repository = repo as Record<string, unknown>
  const permissions = record(repository.permissions)
  const state = enumValue(
    pull.mergeable_state,
    ['clean', 'blocked', 'dirty', 'unstable', 'behind'],
    'unknown'
  )
  const reviewers = mapReviewers(graph.pull)
  const { requestedUsers, requestedTeams } = requestedReviewers(reviewers.reviewRequests)
  const targets = findPullRequestReferences(string(pull.body), ref)
  const queried = new Set(graph.referenceTargets.map(referenceKey))
  const missing = targets.filter((target) => !queried.has(referenceKey(target)))
  let references = graph.references
  if (missing.length) {
    try {
      const response = record(
        await ghApi(
          'graphql',
          '-f',
          `query=query {
        rateLimit { cost remaining resetAt }
        ${pullRequestReferenceFields(missing, 0)}
      }`
        )
      )
      references = [...references, ...mapPullRequestReferences(response.data, missing, 0)]
    } catch (error) {
      console.warn(`[pr-fetch] ${prKey(ref)} could not resolve references: ${String(error)}`)
    }
  }
  const wanted = new Set(targets.map(referenceKey))
  const fixture = {
    pull: {
      ...pull,
      state: enumValue(pull.state, ['open', 'closed'], 'closed'),
      body: string(pull.body),
      user: user(pull.user),
      mergeable_state: state,
      requested_reviewers: requestedUsers,
    },
    reviews: reviews.map((value) => {
      const review = record(value)
      return {
        ...review,
        user: user(review.user),
        state: enumValue(
          review.state,
          ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED'],
          'COMMENTED'
        ),
        body: string(review.body),
        submitted_at: string(review.submitted_at),
      }
    }),
    reviewComments: reviewComments.map((value) => {
      const comment = record(value)
      return {
        ...comment,
        user: user(comment.user),
        body: string(comment.body),
        line: comment.line ?? null,
        pull_request_review_id: comment.pull_request_review_id ?? 0,
        resolved: graph.resolved.get(Number(comment.in_reply_to_id ?? comment.id)) ?? false,
      }
    }),
    issueComments: graph.issueComments,
    checkRuns: mapCheckRuns(graph.checks),
    checkRollupState: graph.checkRollupState,
    checkRunsTotalCount: graph.checkRunsTotalCount,
    commits: commits.map((value) => {
      const item = record(value)
      const commit = record(item.commit)
      const author = record(commit.author)
      return {
        ...item,
        commit: { ...commit, author: { name: string(author.name), date: string(author.date) } },
        author: item.author ? user(item.author) : null,
      }
    }),
    files: files.map((value) => {
      const file = record(value)
      return {
        ...file,
        status: enumValue(file.status, ['added', 'removed', 'modified', 'renamed'], 'modified'),
      }
    }),
    closingIssuesReferences: graph.closingIssuesReferences,
    references: references.filter((reference) => wanted.has(referenceKey(reference))),
    suggestedReviewers: graph.suggestedReviewers,
    ...reviewers,
    mergeable: graph.pull.mergeable,
    mergeStateStatus: string(graph.pull.mergeStateStatus, 'UNKNOWN'),
    behindBy: headMoved ? null : graph.behindBy,
    truncatedConnections: graph.truncatedConnections,
    requestedTeams,
    reviewDecision:
      (['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'] as const).find(
        (decision) => decision === graph.reviewDecision
      ) ?? null,
    viewerCanRequestReviews:
      permissions.admin === true ||
      permissions.maintain === true ||
      permissions.push === true ||
      permissions.triage === true,
    mergeCommitAllowed: repository.allow_merge_commit === true,
    squashMergeAllowed: repository.allow_squash_merge === true,
    rebaseMergeAllowed: repository.allow_rebase_merge === true,
    viewerDefaultMergeMethod:
      repository.allow_squash_merge === true
        ? 'SQUASH'
        : repository.allow_merge_commit === true
          ? 'MERGE'
          : 'REBASE',
  }
  return Schema.decodeUnknownSync(PullRequestData)(fixture)
}

async function fetchReviewerCandidates(repo: string, search: string) {
  const [owner, name] = repo.split('/')
  const query = `query($owner:String!,$name:String!,$search:String) {
    rateLimit { cost remaining resetAt }
    repository(owner:$owner,name:$name) { assignableUsers(first:100,query:$search) {
      pageInfo { hasNextPage }
      nodes { login name avatarUrl url }
    } }
  }`
  const response = record(
    await ghApi(
      'graphql',
      '-f',
      `query=${query}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      ...(search ? ['-f', `search=${search}`] : [])
    )
  )
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
  return requestApi(
    [
      '--method',
      requested ? 'POST' : 'DELETE',
      `repos/${ref.repo}/pulls/${ref.number}/requested_reviewers`,
    ],
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

function prKey(ref: PullRequestRef) {
  return `${ref.repo}#${ref.number}`
}

export function createPullRequests(store: Store, hub: Hub) {
  const visibleLimit = 3
  const prefetchLimit = 2
  const queuedPrefetchLimit = 4
  type Job = {
    ref: PullRequestRef
    key: string
    priority: 'visible' | 'prefetch'
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
  const jobs = new Map<string, Job>()
  const queue: Job[] = []
  let activeVisible = 0
  let activePrefetches = 0
  const watches = new Map<string, Map<symbol, GitHubActivity>>()
  const lastChecks = new Map<string, number>()
  const checking = new Set<string>()
  const lastCadences = new Map<string, string>()
  let linksPolledAt = 0

  function revision(key: string) {
    return revisions.get(key) ?? 0
  }

  function finish(job: Job, fetched: PullRequestSnapshot) {
    if (!jobs.delete(job.key)) return
    if (job.priority === 'prefetch') activePrefetches--
    else activeVisible--
    void Effect.runPromise(publish(job.ref, fetched, job.revision)).then(job.resolve, () =>
      job.resolve(undefined)
    )
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
            data: await fetchPullRequest(job.ref, graph),
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
            `[pr-fetch] ${job.key} ${job.priority} batch=${batch.length} wait=${startedAt - job.queuedAt}ms fetch=${Date.now() - startedAt}ms`
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
          index = queue.findIndex((job) => job.priority === 'prefetch')
        if (index < 0) break
        const job = queue.splice(index, 1)[0]!
        job.started = true
        if (job.priority === 'prefetch') activePrefetches++
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

  function schedule(ref: PullRequestRef, priority: Job['priority']) {
    const key = prKey(ref)
    if (pendingOperations.has(key)) return Promise.resolve(undefined)
    const existing = jobs.get(key)
    if (existing) {
      if (priority === 'visible' && existing.priority === 'prefetch') {
        if (existing.started) {
          activePrefetches--
          activeVisible++
        }
        existing.priority = 'visible'
      }
      drain()
      return existing.promise
    }
    if (
      priority === 'prefetch' &&
      queue.filter((job) => job.priority === 'prefetch').length >= queuedPrefetchLimit
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
  function publish(ref: PullRequestRef, fetched: PullRequestSnapshot, fetchedRevision: number) {
    return publication.withPermit(
      Effect.gen(function* () {
        if (fetchedRevision !== revision(prKey(ref))) return undefined
        yield* store.savePullRequest(fetched)
        // The stored snapshot keeps the last good data when this read failed.
        const snapshot = decorate(yield* store.getPullRequest(ref.repo, ref.number))
        hub.pushPullRequest(snapshot)
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

  function activity(ref: PullRequestRef): GitHubActivity {
    const values = [...(watches.get(prKey(ref))?.values() ?? [])]
    return values.includes('focused')
      ? 'focused'
      : values.includes('blurred')
        ? 'blurred'
        : 'hidden'
  }

  function watch(ref: PullRequestRef, state: GitHubActivity) {
    const key = prKey(ref)
    const token = Symbol()
    return Effect.acquireRelease(
      Effect.sync(() => {
        const subscribers = watches.get(key) ?? new Map()
        subscribers.set(token, state)
        watches.set(key, subscribers)
      }),
      () =>
        Effect.sync(() => {
          const subscribers = watches.get(key)
          subscribers?.delete(token)
          if (!subscribers?.size) watches.delete(key)
        })
    )
  }

  function cadence(closed: boolean, state: GitHubActivity, list: boolean) {
    if (state === 'hidden' || backingOff()) return null
    const interval = closed ? 30 * 60_000 : list || state === 'blurred' ? 120_000 : 30_000
    return interval * cadenceMultiplier()
  }

  function decorate(snapshot: PullRequestSnapshot): PullRequestSnapshot {
    const key = prKey(snapshot)
    const watched = watches.has(key)
    const state = watched ? activity(snapshot) : hub.githubActivity()
    const interval = cadence(snapshot.data?.pull.state === 'closed', state, !watched)
    const checksInterval =
      interval !== null && checksRunning(snapshot.data)
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
      return yield* refresh(ref)
    })
  }

  function prefetch(ref: PullRequestRef) {
    return Effect.gen(function* () {
      const cached = yield* get(ref)
      const interval = cadence(cached.data?.pull.state === 'closed', 'blurred', true)
      if (interval === null || (cached.refreshedAt && Date.now() - cached.refreshedAt < interval))
        return cached
      return (yield* Effect.promise(() => schedule(ref, 'prefetch'))) ?? cached
    })
  }

  // One cheap query notices change on every linked PR; only changed ones pay for a full read.
  // Check runs don't bump updatedAt, so the rollup state is compared too.
  function refreshChangedLinks() {
    return Effect.gen(function* () {
      if (
        hub.githubActivity() === 'hidden' ||
        backingOff() ||
        Date.now() - linksPolledAt < 30_000 * cadenceMultiplier()
      )
        return
      const links = (yield* store.activePullRequestLinks()).filter((link) =>
        validPullRequestRef(link)
      )
      if (!links.length) return
      linksPolledAt = Date.now()
      const graphs = yield* Effect.promise(() => fetchGraphqlBatch(links, pullRequestStateFields))
      const changed = links.filter((link, index) => {
        const graph = graphs[index]!
        return (
          !(graph instanceof GhFailure) &&
          (string(graph.pull.updatedAt) !== link.updated_at ||
            graph.checkRollupState !== link.checks)
        )
      })
      // Scheduled all at once, they would overflow the prefetch queue and drop the rest.
      yield* Effect.forEach(changed, (link) => Effect.promise(() => schedule(link, 'prefetch')), {
        concurrency: prefetchLimit,
        discard: true,
      })
    })
  }

  function refreshChecks(ref: PullRequestRef) {
    const key = prKey(ref)
    return Effect.gen(function* () {
      if (checking.has(key) || jobs.has(key) || pendingOperations.has(key)) return
      checking.add(key)
      lastChecks.set(key, Date.now())
      const fetchedRevision = revision(key)
      const [graph] = yield* Effect.tryPromise({
        try: () => fetchGraphqlBatch([ref], checkRollupFields),
        catch: (error) => new StoreError('internal', String(error)),
      }).pipe(Effect.ensuring(Effect.sync(() => checking.delete(key))))
      const snapshot = yield* get(ref)
      if (!graph || graph instanceof GhFailure || !snapshot.data) return
      if (graph.headSha !== snapshot.data.pull.head.sha) {
        yield* refresh(ref)
        return
      }
      const data = {
        ...snapshot.data,
        checkRuns: mapCheckRuns(graph.checks),
        checkRollupState: graph.checkRollupState,
        checkRunsTotalCount: graph.checkRunsTotalCount,
        truncatedConnections: [
          ...(snapshot.data.truncatedConnections ?? []).filter((field) => field !== 'checkRuns'),
          ...graph.truncatedConnections.filter((field) => field === 'checkRuns'),
        ],
      }
      yield* publish(ref, { ...snapshot, data }, fetchedRevision)
    })
  }

  function poll(ref: PullRequestRef) {
    return Effect.gen(function* () {
      const snapshot = yield* refreshIfStale(ref)
      const interval = snapshot.rateLimit?.checksCadenceMs
      const checkedAt = Math.max(lastChecks.get(prKey(ref)) ?? 0, snapshot.refreshedAt ?? 0)
      if (interval && Date.now() - checkedAt >= interval) yield* refreshChecks(ref)
    })
  }

  function write(
    ref: PullRequestRef,
    operation: NonNullable<PullRequestSnapshot['pendingOperation']>,
    optimistic: (data: PullRequestData) => PullRequestData,
    send: () => Promise<unknown>,
    confirm: (data: PullRequestData, response: unknown) => PullRequestData = (data) => data
  ) {
    const key = prKey(ref)
    const applied = Effect.gen(function* () {
      const previous = yield* publication.withPermit(
        Effect.gen(function* () {
          const snapshot = yield* get(ref)
          pendingOperations.set(key, operation)
          revisions.set(key, revision(key) + 1)
          return snapshot
        })
      )
      function save(data: PullRequestData | undefined) {
        return publication.withPermit(
          Effect.gen(function* () {
            const snapshot = { ...previous, data }
            yield* store.savePullRequest(snapshot)
            hub.pushPullRequest(decorate(snapshot))
          })
        )
      }
      yield* Effect.gen(function* () {
        if (previous.data) yield* save(optimistic(previous.data))
        else hub.pushPullRequest(decorate(previous))
        const result = yield* Effect.tryPromise({ try: send, catch: writeError }).pipe(
          Effect.tapError(() => save(previous.data))
        )
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
      return writing.withPermit(applied).pipe(
        Effect.onExit(() =>
          Effect.gen(function* () {
            const queued = queuedWrites.get(key)! - 1
            if (queued) {
              queuedWrites.set(key, queued)
              return
            }
            queuedWrites.delete(key)
            const running = jobs.get(key)
            if (running) yield* Effect.promise(() => running.promise)
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
        requestApi(
          ['--method', 'PATCH', `repos/${ref.repo}/pulls/${ref.number}`],
          JSON.stringify({ title })
        ),
      (data, result) => ({
        ...data,
        pull: { ...data.pull, title: string(record(result).title, title) },
      })
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
          await requestApi(
            ['--method', 'PUT', `repos/${ref.repo}/pulls/${ref.number}/merge`],
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
    get,
    refresh,
    prefetch,
    refreshIfStale,
    refreshChangedLinks,
    setReviewRequest,
    reviewerCandidates,
    watch,
    poll,
    updateTitle,
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

const checkStates: Record<string, PullRequestListItem['checks']> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  PENDING: 'pending',
  EXPECTED: 'pending',
}

function itemChecksRunning(item: PullRequestListItem) {
  return item.checks === 'pending' && (item.state === 'open' || item.state === 'draft')
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
  const checks = checkStates[string(rollup.state)]
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
    updatedAt: Date.parse(string(node.updatedAt)) || 0,
  }
}

export function pullRequestListGraphqlQuery(tabs: readonly PullRequestListTab[]) {
  const searches = tabs.flatMap(listSearches)
  const fields = `issueCount nodes { ... on PullRequest {
    number title url isDraft state merged updatedAt closedAt repository { nameWithOwner }
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

async function fetchPullRequestLists(tabs: readonly PullRequestListTab[]) {
  const { searches, query } = pullRequestListGraphqlQuery(tabs)
  const response = await ghApi(
    'graphql',
    '-f',
    `query=${query}`,
    ...searches.flatMap((search, index) => ['-f', `q${index}=${search}`])
  )
  return tabs.map(
    (tab, index): PullRequestList => ({
      tab,
      status: 'ready',
      ...mapPullRequestList(response, index),
      refreshedAt: Date.now(),
    })
  )
}

export function createPullRequestLists(store: Store, hub: Hub) {
  const inFlight = new Map<PullRequestListTab, Promise<PullRequestList>>()

  const queued = new Map<PullRequestListTab, (list: PullRequestList) => void>()
  let flushQueued = false

  function decorate(list: PullRequestList, activity = hub.githubActivity()): PullRequestList {
    const paused = activity === 'hidden' || backingOff()
    return {
      ...list,
      rateLimit: githubRateLimitHealth(
        paused ? null : 120_000 * cadenceMultiplier(),
        !paused && list.items?.some(itemChecksRunning) ? 30_000 * cadenceMultiplier() : null
      ),
    }
  }

  function get(tab: PullRequestListTab) {
    return store.getPullRequestList(tab).pipe(Effect.map((list) => decorate(list)))
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
              resolve(lists[index]!)
            }
          },
          (error) => {
            for (const [tab, resolve] of batch) {
              inFlight.delete(tab)
              resolve({
                tab,
                status:
                  error instanceof GhFailure && error.kind === 'rate_limited'
                    ? 'rate_limited'
                    : 'unavailable',
                error: error instanceof GhFailure ? error.message : 'GitHub API is unavailable',
                refreshedAt: Date.now(),
              })
            }
          }
        )
      })
    }
    return promise
  }

  function refresh(tab: PullRequestListTab) {
    return Effect.gen(function* () {
      yield* store.savePullRequestList(yield* Effect.promise(() => load(tab)))
      // The stored list keeps the last good items when this read failed.
      const list = yield* store.getPullRequestList(tab)
      const decorated = decorate(list)
      hub.pushPullRequestList(decorated)
      return decorated
    })
  }

  function refreshIfStale(tab: PullRequestListTab, activity: GitHubActivity = 'focused') {
    return Effect.gen(function* () {
      const list = decorate(yield* store.getPullRequestList(tab), activity)
      const maxAge = list.rateLimit?.cadenceMs
      if (!maxAge || (list.refreshedAt && Date.now() - list.refreshedAt < maxAge)) return list
      return yield* refresh(tab)
    })
  }

  const lastCheckRefresh = new Map<PullRequestListTab, number>()
  const checkingTabs = new Set<PullRequestListTab>()

  function poll(tab: PullRequestListTab, activity: GitHubActivity) {
    return Effect.gen(function* () {
      const list = yield* refreshIfStale(tab, activity)
      const interval = list.rateLimit?.checksCadenceMs
      if (
        !interval ||
        checkingTabs.has(tab) ||
        Date.now() - (lastCheckRefresh.get(tab) ?? list.refreshedAt ?? 0) < interval
      )
        return
      checkingTabs.add(tab)
      lastCheckRefresh.set(tab, Date.now())
      const refs = (list.items ?? []).filter(itemChecksRunning)
      yield* Effect.gen(function* () {
        const graphs = yield* Effect.tryPromise({
          try: () => fetchGraphqlBatch(refs, pullRequestStateFields),
          catch: (error) => new StoreError('internal', String(error)),
        })
        const checks = new Map<string, PullRequestListItem['checks']>()
        for (const [index, ref] of refs.entries()) {
          const graph = graphs[index]!
          if (!(graph instanceof GhFailure))
            checks.set(prKey(ref), checkStates[graph.checkRollupState])
        }
        const current = yield* store.getPullRequestList(tab)
        const updated = decorate(
          {
            ...current,
            items: current.items?.map((item) => {
              const state = checks.get(prKey(item))
              return state ? { ...item, checks: state } : item
            }),
          },
          activity
        )
        yield* store.savePullRequestList(updated)
        hub.pushPullRequestList(updated)
      }).pipe(Effect.ensuring(Effect.sync(() => checkingTabs.delete(tab))))
    })
  }

  return {
    get,
    refresh,
    refreshIfStale,
    poll,
  }
}

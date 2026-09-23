import type {
  PullRequestList,
  PullRequestListItem,
  PullRequestListTab,
  PullRequestSnapshot,
} from '@jetty/shared/wire'

import { PullRequestData } from '@jetty/shared/pull-request'
import { Effect, Schema, Scope } from 'effect'

import type { Hub } from './hub'
import type { Store } from './store'

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

export function validPullRequestRef(ref: PullRequestRef): boolean {
  const parts = ref.repo.split('/')
  return (
    parts.length === 2 &&
    parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..') &&
    Number.isSafeInteger(ref.number) &&
    ref.number > 0
  )
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

export function createAutoLinkPullRequests(
  store: Store,
  hub: Hub,
  pulls: ReturnType<typeof createPullRequests>,
  scope: Scope.Scope
) {
  return (threadId: string, text: string) =>
    Effect.gen(function* () {
      for (const ref of pullRequestUrls(text)) {
        if (yield* store.hasPullRequestLink(threadId, ref.repo, ref.number)) continue
        yield* hub.withChromePublication(
          Effect.gen(function* () {
            if (yield* store.hasPullRequestLink(threadId, ref.repo, ref.number)) return
            const thread = yield* store.linkPullRequest(threadId, ref.repo, ref.number)
            hub.pushChrome({ type: 'thread.upserted', thread })
          })
        )
        yield* pulls.refreshIfStale(ref).pipe(
          Effect.catchCause((cause) => Effect.logWarning(cause)),
          Effect.forkIn(scope)
        )
      }
    })
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
    message: string
  ) {
    super(message)
  }
}

async function ghApi(...args: string[]): Promise<unknown> {
  const gh = Bun.which('gh')
  if (!gh) throw new GhFailure('unavailable', 'GitHub CLI is not installed')
  try {
    const child = Bun.spawn([gh, 'api', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal: AbortSignal.timeout(20000),
    })
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code === 0) return JSON.parse(out)
    const detail = err.trim()
    if (/rate limit|secondary rate limit|abuse detection/i.test(detail))
      throw new GhFailure('rate_limited', 'GitHub API rate limit reached')
    if (/HTTP 404|Not Found|HTTP 403/i.test(detail))
      throw new GhFailure('not_found', 'Pull request not found or access denied')
    if (/authentication|not logged|HTTP 401|gh auth login/i.test(detail))
      throw new GhFailure('unavailable', 'Sign in with gh auth login to view pull requests')
    throw new GhFailure('unavailable', detail || 'GitHub API is unavailable')
  } catch (error) {
    if (error instanceof GhFailure) throw error
    throw new GhFailure('unavailable', 'GitHub API is unavailable')
  }
}

async function ghGraphql(ref: PullRequestRef): Promise<{
  resolved: Map<number, boolean>
  closingIssuesReferences: unknown[]
  suggestedReviewers: unknown[]
}> {
  const gh = Bun.which('gh')
  if (!gh) return { resolved: new Map(), closingIssuesReferences: [], suggestedReviewers: [] }
  const [owner, name] = ref.repo.split('/')
  const query = `query($owner:String!,$name:String!,$number:Int!) {
    repository(owner:$owner,name:$name) { pullRequest(number:$number) {
      closingIssuesReferences(first:100) { nodes { number title url repository { nameWithOwner } } }
      reviewThreads(first:100) { nodes { isResolved comments(first:100) { nodes { databaseId } } } }
      suggestedReviewers { reviewer { ... on User { login avatarUrl url } } }
    } }
  }`
  try {
    const child = Bun.spawn(
      [
        gh,
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${ref.number}`,
      ],
      {
        stdout: 'pipe',
        stderr: 'ignore',
        signal: AbortSignal.timeout(20000),
      }
    )
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    if (code !== 0)
      return { resolved: new Map(), closingIssuesReferences: [], suggestedReviewers: [] }
    const pull = JSON.parse(out).data?.repository?.pullRequest
    const resolved = new Map<number, boolean>()
    for (const thread of pull?.reviewThreads?.nodes ?? [])
      for (const comment of thread.comments?.nodes ?? [])
        if (comment.databaseId) resolved.set(comment.databaseId, thread.isResolved === true)
    return {
      resolved,
      closingIssuesReferences: pull?.closingIssuesReferences?.nodes ?? [],
      suggestedReviewers: (pull?.suggestedReviewers ?? []).flatMap(
        (value: { reviewer?: { login?: string; avatarUrl?: string; url?: string } }) =>
          value.reviewer?.login
            ? [
                {
                  login: value.reviewer.login,
                  avatar_url: value.reviewer.avatarUrl ?? '',
                  html_url: value.reviewer.url ?? '',
                },
              ]
            : []
      ),
    }
  } catch {
    return { resolved: new Map(), closingIssuesReferences: [], suggestedReviewers: [] }
  }
}

async function ghCheckRollup(ref: PullRequestRef, sha: string): Promise<unknown[]> {
  const [owner, name] = ref.repo.split('/')
  const query = `query($owner:String!,$name:String!,$sha:GitObjectID!,$after:String) {
    repository(owner:$owner,name:$name) { object(oid:$sha) { ... on Commit {
      statusCheckRollup { contexts(first:100,after:$after) {
        nodes {
          __typename
          ... on CheckRun {
            id name status conclusion detailsUrl startedAt completedAt
            checkSuite { app { name } workflowRun { workflow { name } } }
          }
          ... on StatusContext { id context state targetUrl createdAt updatedAt }
        }
        pageInfo { hasNextPage endCursor }
      } }
    } } }
  }`
  const contexts: unknown[] = []
  let after: string | undefined
  do {
    const response = record(
      await ghApi(
        'graphql',
        '-f',
        `query=${query}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-f',
        `sha=${sha}`,
        ...(after ? ['-f', `after=${after}`] : [])
      )
    )
    const rollup = record(record(record(record(response.data).repository).object).statusCheckRollup)
    const connection = record(rollup.contexts)
    contexts.push(...((connection.nodes as unknown[] | undefined) ?? []))
    const pageInfo = record(connection.pageInfo)
    after = pageInfo.hasNextPage ? string(pageInfo.endCursor) : undefined
  } while (after)
  return contexts
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback
}

async function fetchPullRequest(ref: PullRequestRef): Promise<PullRequestData> {
  const base = `repos/${ref.repo}`
  const pull = (await ghApi(`${base}/pulls/${ref.number}`)) as Record<string, unknown>
  const head = pull.head as { sha: string }
  const [reviews, reviewComments, checks, commits, files, repo, graph] = await Promise.all([
    ghPages(`${base}/pulls/${ref.number}/reviews`),
    ghPages(`${base}/pulls/${ref.number}/comments`),
    ghCheckRollup(ref, head.sha),
    ghPages(`${base}/pulls/${ref.number}/commits`),
    ghPages(`${base}/pulls/${ref.number}/files`),
    ghApi(base),
    ghGraphql(ref),
  ])
  const repository = repo as Record<string, unknown>
  function user(value: unknown) {
    const valueRecord = record(value)
    return {
      login: string(valueRecord.login, 'ghost'),
      avatar_url: string(valueRecord.avatar_url),
      html_url: string(valueRecord.html_url),
    }
  }
  const state = enumValue(
    pull.mergeable_state,
    ['clean', 'blocked', 'dirty', 'unstable'],
    'unknown'
  )
  const fixture = {
    pull: {
      ...pull,
      state: enumValue(pull.state, ['open', 'closed'], 'closed'),
      body: string(pull.body),
      user: user(pull.user),
      mergeable_state: state,
      requested_reviewers: ((pull.requested_reviewers as unknown[]) ?? []).map(user),
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
        resolved: graph.resolved.get(Number(comment.id)) ?? false,
      }
    }),
    checkRuns: checks.map((value) => {
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
          started_at: string(check.createdAt),
          completed_at:
            state === 'PENDING' || state === 'EXPECTED' ? null : string(check.updatedAt),
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
          status === 'COMPLETED'
            ? 'completed'
            : status === 'IN_PROGRESS'
              ? 'in_progress'
              : 'queued',
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
                ],
                'neutral'
              ),
        started_at: string(check.startedAt),
        completed_at: check.completedAt ?? null,
        html_url: string(check.detailsUrl),
        app: { name: string(record(suite.app).name, 'GitHub') },
      }
    }),
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
    closingIssuesReferences: graph.closingIssuesReferences.map((value) => {
      const issue = record(value)
      return {
        number: Number(issue.number),
        title: string(issue.title),
        url: string(issue.url),
        ...(issue.repository
          ? { repository: { nameWithOwner: string(record(issue.repository).nameWithOwner) } }
          : {}),
      }
    }),
    suggestedReviewers: graph.suggestedReviewers,
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
    promise: Promise<PullRequestSnapshot | undefined>
    resolve: (snapshot: PullRequestSnapshot | undefined) => void
  }
  const jobs = new Map<string, Job>()
  const queue: Job[] = []
  let activeVisible = 0
  let activePrefetches = 0

  function drain() {
    while (true) {
      let index =
        activeVisible < visibleLimit ? queue.findIndex((job) => job.priority === 'visible') : -1
      if (index < 0 && activePrefetches < prefetchLimit)
        index = queue.findIndex((job) => job.priority === 'prefetch')
      if (index < 0) return
      const job = queue.splice(index, 1)[0]!
      job.started = true
      if (job.priority === 'prefetch') activePrefetches++
      else activeVisible++
      const waitMs = Date.now() - job.queuedAt
      const startedAt = Date.now()
      void (async () => {
        let snapshot: PullRequestSnapshot
        try {
          snapshot = {
            ...job.ref,
            status: 'ready',
            data: await fetchPullRequest(job.ref),
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
            `[pr-fetch] ${job.key} ${job.priority} wait=${waitMs}ms fetch=${Date.now() - startedAt}ms`
          )
        jobs.delete(job.key)
        if (job.priority === 'prefetch') activePrefetches--
        else activeVisible--
        job.resolve(snapshot)
        drain()
      })()
    }
  }

  function schedule(ref: PullRequestRef, priority: Job['priority']) {
    const key = `${ref.repo}#${ref.number}`
    if (priority === 'visible') {
      for (const job of queue.splice(0)) {
        if (job.key === key) {
          job.priority = 'visible'
          queue.push(job)
        } else if (job.priority === 'prefetch') {
          jobs.delete(job.key)
          job.resolve(undefined)
        } else queue.push(job)
      }
    }
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
    const job: Job = { ref, key, priority, queuedAt: Date.now(), started: false, promise, resolve }
    jobs.set(key, job)
    queue.push(job)
    drain()
    return promise
  }

  function refresh(ref: PullRequestRef): Effect.Effect<PullRequestSnapshot, StoreError> {
    return Effect.gen(function* () {
      const fetched = yield* Effect.promise(() => schedule(ref, 'visible'))
      yield* store.savePullRequest(fetched!)
      // The stored snapshot keeps the last good data when this read failed.
      const snapshot = yield* store.getPullRequest(ref.repo, ref.number)
      hub.pushPullRequest(snapshot)
      for (const threadId of yield* store.threadsForPullRequest(ref.repo, ref.number)) {
        const thread = yield* store.requireThread(threadId)
        hub.pushChrome({ type: 'thread.upserted', thread })
      }
      return snapshot
    })
  }

  function prefetch(ref: PullRequestRef) {
    return Effect.gen(function* () {
      const cached = yield* store.getPullRequest(ref.repo, ref.number)
      if (cached.refreshedAt && Date.now() - cached.refreshedAt < 60_000) return cached
      const pull = (cached.data as { pull?: { state?: string } } | undefined)?.pull
      if (pull?.state === 'closed') return cached
      const fetched = yield* Effect.promise(() => schedule(ref, 'prefetch'))
      if (!fetched) return yield* store.getPullRequest(ref.repo, ref.number)
      yield* store.savePullRequest(fetched)
      const snapshot = yield* store.getPullRequest(ref.repo, ref.number)
      hub.pushPullRequest(snapshot)
      return snapshot
    })
  }

  function get(ref: PullRequestRef) {
    return store.getPullRequest(ref.repo, ref.number)
  }

  function refreshIfStale(ref: PullRequestRef, maxAge = 60_000) {
    return Effect.gen(function* () {
      const snapshot = yield* get(ref)
      if (snapshot.refreshedAt && Date.now() - snapshot.refreshedAt < maxAge) return snapshot
      const pull = (snapshot.data as { pull?: { state?: string } } | undefined)?.pull
      if (pull?.state === 'closed') return snapshot
      return yield* refresh(ref)
    })
  }

  return { get, refresh, prefetch, refreshIfStale }
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

async function fetchPullRequestList(tab: PullRequestListTab) {
  const searches = listSearches(tab)
  const fields = `issueCount nodes { ... on PullRequest {
    number title url isDraft state merged updatedAt closedAt repository { nameWithOwner }
    commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
  } }`
  const query = `query(${searches.map((_, index) => `$q${index}:String!`).join(',')}) {
    ${searches.map((_, index) => `s${index}: search(query:$q${index},type:ISSUE,first:${listLimit}) { ${fields} }`).join('\n')}
  }`
  const response = record(
    await ghApi(
      'graphql',
      '-f',
      `query=${query}`,
      ...searches.flatMap((search, index) => ['-f', `q${index}=${search}`])
    )
  )
  const since = Date.parse(recentSince())
  const found = new Map<string, PullRequestListItem>()
  let truncated = false
  for (const result of Object.values(record(response.data))) {
    const nodes = (record(result).nodes as unknown[] | undefined) ?? []
    if (Number(record(result).issueCount) > nodes.length) truncated = true
    for (const node of nodes) {
      const closedAt = Date.parse(string(record(node).closedAt))
      if (closedAt < since) continue
      const item = listItem(node)
      if (item) found.set(`${item.repo}#${item.number}`, item)
    }
  }
  const items = [...found.values()].sort((left, right) => right.updatedAt - left.updatedAt)
  return { items, truncated }
}

export function createPullRequestLists(store: Store, hub: Hub) {
  const inFlight = new Map<PullRequestListTab, Promise<PullRequestList>>()

  function load(tab: PullRequestListTab) {
    let pending = inFlight.get(tab)
    if (pending) return pending
    pending = fetchPullRequestList(tab).then(
      ({ items, truncated }): PullRequestList => ({
        tab,
        status: 'ready',
        items,
        ...(truncated ? { truncated } : {}),
        refreshedAt: Date.now(),
      }),
      (error): PullRequestList => ({
        tab,
        status:
          error instanceof GhFailure && error.kind === 'rate_limited'
            ? 'rate_limited'
            : 'unavailable',
        error: error instanceof GhFailure ? error.message : 'GitHub API is unavailable',
        refreshedAt: Date.now(),
      })
    )
    inFlight.set(tab, pending)
    void pending.finally(() => inFlight.delete(tab))
    return pending
  }

  function refresh(tab: PullRequestListTab) {
    return Effect.gen(function* () {
      yield* store.savePullRequestList(yield* Effect.promise(() => load(tab)))
      // The stored list keeps the last good items when this read failed.
      const list = yield* store.getPullRequestList(tab)
      hub.pushPullRequestList(list)
      return list
    })
  }

  function refreshIfStale(tab: PullRequestListTab) {
    return Effect.gen(function* () {
      const list = yield* store.getPullRequestList(tab)
      const maxAge = list.status === 'rate_limited' ? 5 * 60_000 : 60_000
      if (list.refreshedAt && Date.now() - list.refreshedAt < maxAge) return list
      return yield* refresh(tab)
    })
  }

  return { get: store.getPullRequestList, refresh, refreshIfStale }
}

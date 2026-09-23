import type { PullRequestSnapshot } from '@jetty/shared/wire'

import { PullRequestData } from '@jetty/shared/pull-request'
import { Effect, Schema } from 'effect'

import type { Hub } from './hub'
import type { Store } from './store'

import { StoreError } from './store'

export type PullRequestRef = { repo: string; number: number }

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
  }
  return [...found.values()]
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

type GhFailure = { kind: 'unavailable' | 'not_found' | 'rate_limited'; message: string }

async function ghApi(path: string): Promise<unknown> {
  const gh = Bun.which('gh')
  if (!gh) throw { kind: 'unavailable', message: 'GitHub CLI is not installed' } satisfies GhFailure
  try {
    const child = Bun.spawn([gh, 'api', path], {
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
      throw { kind: 'rate_limited', message: 'GitHub API rate limit reached' } satisfies GhFailure
    if (/HTTP 404|Not Found/i.test(detail))
      throw {
        kind: 'not_found',
        message: 'Pull request not found or access denied',
      } satisfies GhFailure
    if (/HTTP 403/i.test(detail))
      throw {
        kind: 'not_found',
        message: 'Pull request not found or access denied',
      } satisfies GhFailure
    if (/authentication|not logged|HTTP 401|gh auth login/i.test(detail))
      throw {
        kind: 'unavailable',
        message: 'Sign in with gh auth login to view pull requests',
      } satisfies GhFailure
    throw {
      kind: 'unavailable',
      message: detail || 'GitHub API is unavailable',
    } satisfies GhFailure
  } catch (error) {
    if (error && typeof error === 'object' && 'kind' in error) throw error
    throw { kind: 'unavailable', message: 'GitHub API is unavailable' } satisfies GhFailure
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
        '-F',
        `owner=${owner}`,
        '-F',
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

async function fetchPullRequest(ref: PullRequestRef): Promise<PullRequestData> {
  const base = `repos/${ref.repo}`
  const pull = (await ghApi(`${base}/pulls/${ref.number}`)) as Record<string, unknown>
  const head = pull.head as { sha: string }
  const [reviews, reviewComments, checks, commits, files, repo, graph] = await Promise.all([
    ghPages(`${base}/pulls/${ref.number}/reviews`),
    ghPages(`${base}/pulls/${ref.number}/comments`),
    ghApi(`${base}/commits/${head.sha}/check-runs?per_page=100`).catch(() => ({ check_runs: [] })),
    ghPages(`${base}/pulls/${ref.number}/commits`),
    ghPages(`${base}/pulls/${ref.number}/files`),
    ghApi(base),
    ghGraphql(ref),
  ])
  const repository = repo as Record<string, unknown>
  const checkRuns = (checks as { check_runs?: unknown[] }).check_runs ?? []
  function record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' ? (value as Record<string, any>) : {}
  }
  function user(value: unknown) {
    const valueRecord = record(value)
    return {
      login: valueRecord.login ?? 'ghost',
      avatar_url: valueRecord.avatar_url ?? '',
      html_url: valueRecord.html_url ?? '',
    }
  }
  const state = ['clean', 'blocked', 'dirty', 'unstable'].includes(String(pull.mergeable_state))
    ? pull.mergeable_state
    : 'unknown'
  const fixture = {
    pull: {
      ...pull,
      body: pull.body ?? '',
      user: user(pull.user),
      mergeable_state: state,
      requested_reviewers: ((pull.requested_reviewers as unknown[]) ?? []).map(user),
    },
    reviews: reviews.map((value) => {
      const review = record(value)
      return {
        ...review,
        user: user(review.user),
        body: review.body ?? '',
        submitted_at: review.submitted_at ?? '',
      }
    }),
    reviewComments: reviewComments.map((value) => {
      const comment = record(value)
      return {
        ...comment,
        user: user(comment.user),
        body: comment.body ?? '',
        line: comment.line ?? null,
        pull_request_review_id: comment.pull_request_review_id ?? 0,
        resolved: graph.resolved.get(comment.id) ?? false,
      }
    }),
    checkRuns: checkRuns.map((value) => {
      const check = record(value)
      return {
        ...check,
        status: ['queued', 'in_progress', 'completed'].includes(check.status)
          ? check.status
          : 'queued',
        started_at: check.started_at ?? '',
        completed_at: check.completed_at ?? null,
        app: { name: record(check.app).name ?? 'GitHub' },
      }
    }),
    commits: commits.map((value) => {
      const item = record(value)
      const commit = record(item.commit)
      const author = record(commit.author)
      return {
        ...item,
        commit: { ...commit, author: { name: author.name ?? '', date: author.date ?? '' } },
        author: item.author ? user(item.author) : null,
      }
    }),
    files: files.map((value) => {
      const file = record(value)
      return {
        ...file,
        status: ['added', 'removed', 'modified', 'renamed'].includes(file.status)
          ? file.status
          : 'modified',
      }
    }),
    closingIssuesReferences: graph.closingIssuesReferences.map((value) => {
      const issue = record(value)
      return {
        number: issue.number,
        title: issue.title,
        url: issue.url,
        ...(issue.repository
          ? { repository: { nameWithOwner: record(issue.repository).nameWithOwner } }
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
  const inFlight = new Map<string, Promise<PullRequestSnapshot>>()

  function refresh(ref: PullRequestRef): Effect.Effect<PullRequestSnapshot, StoreError> {
    return Effect.gen(function* () {
      const key = `${ref.repo}#${ref.number}`
      let pending = inFlight.get(key)
      if (!pending) {
        pending = (async () => {
          try {
            return {
              ...ref,
              status: 'ready' as const,
              data: await fetchPullRequest(ref),
              refreshedAt: Date.now(),
            }
          } catch (error) {
            const failure = error as GhFailure
            return {
              ...ref,
              status: failure.kind ?? 'unavailable',
              error: failure.message ?? 'GitHub API is unavailable',
              refreshedAt: Date.now(),
            }
          }
        })()
        inFlight.set(key, pending)
        void pending.finally(() => inFlight.delete(key))
      }
      yield* store.savePullRequest(yield* Effect.promise(() => pending))
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

  return { get, refresh, refreshIfStale }
}

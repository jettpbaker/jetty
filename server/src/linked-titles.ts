import { Effect } from 'effect'

import type { Store } from './store'

import { prefetchIssue } from './issues'
import { record, string } from './pull-request-graphql'
import { projectRemote, restGet, validRepo } from './pull-requests'

type Reference = { repo: string | null; number: number; kind: 'pull' | 'issue' | 'unknown' }

function references(text: string): Reference[] {
  const found: Reference[] = []
  const seen = new Set<string>()
  const pattern =
    /(?:https?:\/\/)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(pull|issues)\/([0-9]+)|(?<![A-Za-z0-9_.])(?<!\/)(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#([0-9]+)/gi
  for (const match of text.matchAll(pattern)) {
    const repo = match[1] ?? match[4] ?? null
    const number = Number(match[3] ?? match[5])
    if ((repo && !validRepo(repo)) || !Number.isSafeInteger(number) || number < 1) continue
    const kind = match[2] === 'pull' ? 'pull' : match[2] ? 'issue' : 'unknown'
    const key = `${repo?.toLowerCase() ?? ''}#${number}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ repo: repo?.toLowerCase() ?? null, number, kind })
    if (found.length === 3) break
  }
  return found
}

function pullTitle(repo: string, number: number) {
  return Effect.tryPromise({
    try: () => restGet(`repos/${repo}/pulls/${number}`),
    catch: () => null,
  }).pipe(Effect.map((value) => string(record(value).title)))
}

export function linkedTitles(text: string, threadId: string, store: Store) {
  const refs = references(text)
  if (!refs.length) return Effect.succeed([] as string[])
  return Effect.gen(function* () {
    let origin: string | null = null
    if (refs.some((ref) => !ref.repo)) {
      const thread = yield* store.getThread(threadId)
      const project = thread ? yield* store.getProject(thread.projectId) : null
      if (project) origin = yield* Effect.promise(() => projectRemote(project.path))
    }
    const titles = yield* Effect.forEach(
      refs,
      (ref) =>
        Effect.gen(function* () {
          const repo = ref.repo ?? origin
          if (!repo) return null
          const cached = yield* store.getPullRequest(repo, ref.number)
          const cachedTitle = cached.data?.pull.title
          if (ref.kind !== 'issue' && cachedTitle) return `PR #${ref.number}: ${cachedTitle}`
          if (ref.kind === 'pull') {
            const title = yield* pullTitle(repo, ref.number)
            return title ? `PR #${ref.number}: ${title}` : null
          }
          const issue = yield* prefetchIssue({ repo, number: ref.number })
          if (issue.issue?.title) return `Issue #${ref.number}: ${issue.issue.title}`
          if (ref.kind === 'issue') return null
          const title = yield* pullTitle(repo, ref.number)
          return title ? `PR #${ref.number}: ${title}` : null
        }).pipe(Effect.catchCause(() => Effect.succeed(null))),
      { concurrency: 'unbounded' }
    )
    return titles.filter((title): title is string => title !== null)
  }).pipe(
    Effect.timeout('1 second'),
    Effect.catchCause(() => Effect.succeed([] as string[]))
  )
}

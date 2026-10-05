import type { PullRequestActivity } from '@jetty/shared/items'
import type { AgentBehaviours, PullRequestSnapshot, ThreadMeta } from '@jetty/shared/wire'

import {
  failedCheckConclusions,
  rollupChecks,
  type PullRequestData,
} from '@jetty/shared/pull-request'
import { Effect } from 'effect'

import type { Orchestrator } from './orchestrator'
import type { PullRequestRef } from './pull-requests'
import type { Store } from './store'

// Changes that land within QUIET_MS of each other wake the agent once; none waits past MAX_WAIT_MS.
const QUIET_MS = 15_000
const MAX_WAIT_MS = 60_000
const HOUR_MS = 60 * 60_000
const WAKES_PER_HOUR = 6
// A snapshot this old predates the watcher or a long sleep, so what changed since isn't news.
const STALE_MS = 24 * HOUR_MS
// GitHub can list a comment a little after it's made.
const LATE_MS = 10 * 60_000
const EXCERPT = 600
const SECTION_CAP = 12_000

type Group = Extract<keyof AgentBehaviours, 'watchReviews' | 'watchChecks' | 'watchConflicts'>

// One change on a PR: its part of the chat's line, what the agent reads, and whether it wakes it.
export type PullRequestChange = {
  activity: PullRequestActivity
  keys: string[]
  group: Group | null
  wakes: boolean
  text: string
}

type Comment = PullRequestData['reviewComments'][number]

function quote(body: string, indent: string) {
  const text = body.trim()
  if (!text) return ''
  const cut = text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text
  return `\n${indent}> ${cut.replaceAll('\n', `\n${indent}> `)}`
}

function place(comment: Comment) {
  return `${comment.path}${comment.line ? `:${comment.line}` : ''} (${comment.html_url})`
}

function inline(comment: Comment, indent: string) {
  return `\n${indent}- ${place(comment)}${quote(comment.body, `${indent}  `)}`
}

function isBot(login: string) {
  return login === 'Copilot' || login.endsWith('[bot]')
}

const mergeReady = new Set(['CLEAN', 'HAS_HOOKS'])

// What changed between two reads of a PR that its agent would want to hear. The viewer's own
// reviews and comments are left out: agents post as the user, so they may be the agent's own.
// Bots count when they review; their top-level comments (previews, coverage) don't.
export function pullRequestChanges(
  previous: PullRequestData,
  next: PullRequestData,
  since: number,
  failedBefore: boolean
): PullRequestChange[] {
  const { pull } = next
  if (pull.merged) {
    if (previous.pull.merged) return []
    const by = pull.merged_by?.login !== next.viewer?.login ? pull.merged_by?.login : undefined
    return [
      {
        activity: { type: 'merged', ...(by && { actor: by }) },
        keys: ['merged'],
        group: null,
        wakes: false,
        text: `- It was merged${by ? ` by ${by}` : ''}.`,
      },
    ]
  }
  if (pull.state === 'closed')
    return previous.pull.state === 'open'
      ? [
          {
            activity: { type: 'closed' },
            keys: [`closed:${pull.updated_at}`],
            group: null,
            wakes: false,
            text: '- It was closed without merging.',
          },
        ]
      : []
  const changes: PullRequestChange[] = []
  const head = pull.head.sha
  const short = head.slice(0, 7)
  const rollup = rollupChecks[next.checkRollupState ?? '']
  const before = rollupChecks[previous.checkRollupState ?? '']
  if (rollup === 'failure' && (before !== 'failure' || previous.pull.head.sha !== head)) {
    const failing = next.checkRuns.filter(
      (run) => run.conclusion !== null && failedCheckConclusions.includes(run.conclusion)
    )
    const names = failing.map((run) => run.name)
    const running = next.checkRuns.filter((run) => run.status !== 'completed').length
    changes.push({
      activity: {
        type: 'checks_failed',
        ...(names.length && {
          count: names.length,
          detail:
            names.length > 2
              ? `${names.slice(0, 2).join(', ')} +${names.length - 2}`
              : names.join(', '),
        }),
      },
      keys: [`failed:${head}`],
      group: 'watchChecks',
      wakes: true,
      text: [
        `- Checks failed on ${short}${failing.length ? ':' : '.'}`,
        ...failing.slice(0, 10).map((run) => `\n  - ${run.name}: ${run.html_url}`),
        failing.length > 10 ? `\n  - and ${failing.length - 10} more` : '',
        running
          ? `\n  ${running} other ${running === 1 ? 'check is' : 'checks are'} still running.`
          : '',
      ].join(''),
    })
  }
  if (next.mergeable === 'CONFLICTING' && previous.mergeable !== 'CONFLICTING')
    changes.push({
      activity: { type: 'conflict', detail: pull.base.ref },
      keys: [`conflict:${head}:${pull.base.sha ?? ''}`],
      group: 'watchConflicts',
      wakes: true,
      text: `- It has a merge conflict with ${pull.base.ref}.`,
    })

  const viewer = next.viewer?.login.toLowerCase()
  const others = (login: string) => viewer !== undefined && login.toLowerCase() !== viewer
  const fresh = (at: string) => Date.parse(at) > since
  const seenReviews = new Set(previous.reviews.map((review) => review.id))
  const seenComments = new Set(previous.reviewComments.map((comment) => comment.id))
  const seenIssueComments = new Set((previous.issueComments ?? []).map((comment) => comment.id))
  const comments = next.reviewComments.filter(
    (comment) =>
      !seenComments.has(comment.id) && others(comment.user.login) && fresh(comment.created_at)
  )
  const consumed = new Set<number>()
  const commented = new Map<string, { count: number; keys: string[]; text: string[] }>()
  function comment(actor: string, count: number, key: string, text: string) {
    const entry = commented.get(actor) ?? { count: 0, keys: [], text: [] }
    entry.count += count
    entry.keys.push(key)
    entry.text.push(text)
    commented.set(actor, entry)
  }
  const reviewChanges: PullRequestChange[] = []
  for (const review of next.reviews) {
    const login = review.user.login
    if (seenReviews.has(review.id) || !others(login) || !fresh(review.submitted_at)) continue
    const own = comments.filter((comment) => comment.pull_request_review_id === review.id)
    for (const comment of own) consumed.add(comment.id)
    const details = `${quote(review.body, '  ')}${own.map((comment) => inline(comment, '  ')).join('')}`
    const key = `review:${review.id}`
    if (review.state === 'CHANGES_REQUESTED')
      reviewChanges.push({
        activity: { type: 'changes_requested', actor: login },
        keys: [key],
        group: 'watchReviews',
        wakes: true,
        text: `- ${login} requested changes (${review.html_url})${details}`,
      })
    else if (review.state === 'APPROVED')
      reviewChanges.push({
        activity: { type: 'approved', actor: login },
        keys: [key],
        group: 'watchReviews',
        wakes: own.length > 0,
        text: `- ${login} approved it (${review.html_url})${details}`,
      })
    else if (review.state === 'COMMENTED' && details)
      comment(
        login,
        own.length + (review.body.trim() ? 1 : 0),
        key,
        `- ${login} commented (${review.html_url})${details}`
      )
  }
  for (const reviewComment of comments)
    if (!consumed.has(reviewComment.id))
      comment(
        reviewComment.user.login,
        1,
        `comment:${reviewComment.id}`,
        `- ${reviewComment.user.login} commented on ${place(reviewComment)}${quote(reviewComment.body, '  ')}`
      )
  for (const issueComment of next.issueComments ?? [])
    if (
      !seenIssueComments.has(issueComment.id) &&
      others(issueComment.user.login) &&
      !isBot(issueComment.user.login) &&
      fresh(issueComment.created_at)
    )
      comment(
        issueComment.user.login,
        1,
        `issue-comment:${issueComment.id}`,
        `- ${issueComment.user.login} commented (${issueComment.html_url})${quote(issueComment.body, '  ')}`
      )
  changes.push(...reviewChanges.filter((change) => change.wakes))
  for (const [actor, entry] of commented)
    changes.push({
      activity: { type: 'commented', actor, count: entry.count },
      keys: entry.keys,
      group: 'watchReviews',
      wakes: true,
      text: entry.text.join('\n'),
    })
  changes.push(...reviewChanges.filter((change) => !change.wakes))

  const ready =
    !pull.draft &&
    mergeReady.has(next.mergeStateStatus ?? '') &&
    !mergeReady.has(previous.mergeStateStatus ?? '')
  if (rollup === 'success' && (before === 'failure' || failedBefore) && !ready)
    changes.push({
      activity: { type: 'checks_passed' },
      keys: [`passed:${head}`],
      group: 'watchChecks',
      wakes: false,
      text: `- Checks pass on ${short} now.`,
    })
  if (ready)
    changes.push({
      activity: { type: 'ready' },
      keys: [`ready:${head}`],
      group: null,
      wakes: false,
      text: '- GitHub reports it ready to merge.',
    })
  return changes
}

// Comments from one person across reads of the same batch read as one count.
function fold(activity: readonly PullRequestActivity[]) {
  const folded = new Map<string, PullRequestActivity>()
  for (const entry of activity) {
    const key = `${entry.type}:${entry.actor ?? ''}`
    const existing = folded.get(key)
    folded.set(
      key,
      existing && entry.type === 'commented'
        ? { ...entry, count: (existing.count ?? 0) + (entry.count ?? 0) }
        : entry
    )
  }
  return [...folded.values()]
}

function prKey(ref: PullRequestRef) {
  return `${ref.repo}#${ref.number}`
}

type Batch = {
  first: number
  timer?: ReturnType<typeof setTimeout>
  pulls: Map<string, { ref: PullRequestRef; data: PullRequestData; changes: PullRequestChange[] }>
}

// Wakes the thread that owns a PR when the PR needs it, from changes the PR polling already
// reads. Only one thread hears about a PR, so a parent and its child don't both wake.
export function createPullRequestWatch(store: Store, orchestrator: Orchestrator) {
  const fired = new Map<string, Set<string>>()
  const failing = new Set<string>()
  const wakes = new Map<string, number[]>()
  const batches = new Map<string, Batch>()

  // The thread on the PR's branch; else, for a PR the user opened, the thread that linked it first.
  function owner(ref: PullRequestRef, data: PullRequestData) {
    return Effect.gen(function* () {
      const threads: ThreadMeta[] = []
      for (const id of yield* store.threadsForPullRequest(ref.repo, ref.number)) {
        const thread = yield* store.getThread(id)
        if (thread) threads.push(thread)
      }
      const branch = data.pull.head.ref
      const authored =
        data.viewer !== undefined &&
        data.viewer.login.toLowerCase() === data.pull.user.login.toLowerCase()
      const thread =
        threads.find((each) => each.worktree?.branch === branch || each.git?.branch === branch) ??
        (authored ? threads[0] : undefined)
      return thread && !thread.archived ? thread : undefined
    })
  }

  function flush(threadId: string) {
    return Effect.gen(function* () {
      const batch = batches.get(threadId)
      if (!batch) return
      batches.delete(threadId)
      const now = Date.now()
      const lines: Parameters<Orchestrator['pullRequestActivity']>[1][number][] = []
      const sections: string[] = []
      for (const [key, { ref, data, changes }] of batch.pulls) {
        const recent = (wakes.get(key) ?? []).filter((at) => now - at < HOUR_MS)
        const wakeful = changes.some((change) => change.wakes)
        const held = wakeful && recent.length >= WAKES_PER_HOUR
        if (wakeful && !held) {
          recent.push(now)
          const title = data.pull.title.replace(/[[\]]/g, '\\$&')
          const body = changes.map((change) => change.text).join('\n')
          sections.push(
            `New activity on your pull request [#${ref.number} ${title}](${data.pull.html_url}):\n${
              body.length > SECTION_CAP
                ? `${body.slice(0, SECTION_CAP)}\n[Cut here; the pull request has the rest.]`
                : body
            }`
          )
        }
        wakes.set(key, recent)
        lines.push({
          repo: ref.repo,
          number: ref.number,
          activity: fold(changes.map((change) => change.activity)),
          ...(held && { held: true }),
        })
      }
      yield* orchestrator.pullRequestActivity(
        threadId,
        lines,
        sections.length ? sections.join('\n\n') : null
      )
    })
  }

  function collect(
    threadId: string,
    ref: PullRequestRef,
    data: PullRequestData,
    changes: PullRequestChange[]
  ) {
    const batch: Batch = batches.get(threadId) ?? { first: Date.now(), pulls: new Map() }
    const key = prKey(ref)
    const pull = batch.pulls.get(key)
    batch.pulls.set(key, { ref, data, changes: [...(pull?.changes ?? []), ...changes] })
    batches.set(threadId, batch)
    clearTimeout(batch.timer)
    batch.timer = setTimeout(
      () =>
        void Effect.runPromise(flush(threadId)).catch((error: unknown) =>
          console.warn(`[pr-watch] ${threadId} ${String(error)}`)
        ),
      Math.max(0, Math.min(QUIET_MS, batch.first + MAX_WAIT_MS - Date.now()))
    )
    batch.timer.unref()
  }

  return {
    // Whether PR reads should pass their previous snapshot to changed.
    watching: store.getAgentBehaviours().pipe(Effect.map((settings) => settings.watchPullRequests)),
    changed(ref: PullRequestRef, previous: PullRequestSnapshot, next: PullRequestData) {
      return Effect.gen(function* () {
        if (!previous.data || Date.now() - (previous.refreshedAt ?? 0) > STALE_MS) return
        const settings = yield* store.getAgentBehaviours()
        if (!settings.watchPullRequests) return
        const key = prKey(ref)
        const seen = fired.get(key) ?? new Set<string>()
        const changes = pullRequestChanges(
          previous.data,
          next,
          (previous.refreshedAt ?? 0) - LATE_MS,
          failing.has(key)
        ).filter(
          (change) =>
            (!change.group || settings[change.group]) && change.keys.some((each) => !seen.has(each))
        )
        if (changes.some((change) => change.activity.type === 'checks_failed')) failing.add(key)
        if (rollupChecks[next.checkRollupState ?? ''] === 'success') failing.delete(key)
        if (!changes.length) return
        const thread = yield* owner(ref, next)
        if (!thread) return
        for (const change of changes) for (const each of change.keys) seen.add(each)
        while (seen.size > 200) seen.delete(seen.values().next().value!)
        fired.set(key, seen)
        collect(thread.id, ref, next, changes)
      })
    },
  }
}

export type PullRequestWatch = ReturnType<typeof createPullRequestWatch>

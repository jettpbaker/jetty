import type { PullRequestActivity } from '@jetty/shared/items'
import type { AgentBehaviours, PullRequestSnapshot, ThreadMeta } from '@jetty/shared/wire'

import {
  failedCheckConclusions,
  rollupChecks,
  type PullRequestData,
} from '@jetty/shared/pull-request'
import { Effect } from 'effect'

import type { Orchestrator, PullRequestNews } from './orchestrator'
import type { PullRequestRef } from './pull-requests'
import type { Store } from './store'

import { projectRemote } from './pull-requests'

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
  failedBefore: boolean,
  checkEpisode = 0
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
      keys: [`failed:${head}:${checkEpisode + 1}`],
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
      keys: [`passed:${head}:${checkEpisode}`],
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

// What the watcher remembers of a PR, kept on its row so a restart neither repeats a change nor
// drops news still waiting to be told.
export type PullRequestWatchMemory = {
  // Keys of changes already told, newest last.
  fired: string[]
  observedAt?: number
  checkEpisode?: number
  // Checks failed since they last passed.
  failing?: boolean
  // When it woke its thread in the last hour.
  wakes?: number[]
  pending?: { threadId: string; first: number; changes: PullRequestChange[] }
}

// Wakes the thread that owns a PR when the PR needs it, from changes the PR polling already
// reads. Only one thread hears about a PR, so a parent and its child don't both wake.
export function createPullRequestWatch(store: Store, orchestrator: Orchestrator) {
  const timers = new Map<string, { first: number; timer: ReturnType<typeof setTimeout> }>()

  // The thread on the PR's branch; else, for a PR the user opened, the thread that linked it first.
  function owner(ref: PullRequestRef, data: PullRequestData) {
    return Effect.gen(function* () {
      const threads: ThreadMeta[] = []
      const repositories = new Map<string, string | null>()
      const headRepo = data.pull.head.repo?.toLowerCase()
      if (!headRepo) return undefined
      for (const id of yield* store.threadsForPullRequest(ref.repo, ref.number)) {
        const thread = yield* store.getThread(id)
        if (!thread || thread.archived) continue
        if (!repositories.has(thread.projectId)) {
          const project = yield* store.getProject(thread.projectId)
          repositories.set(
            thread.projectId,
            project ? yield* Effect.promise(() => projectRemote(project.path)) : null
          )
        }
        if (repositories.get(thread.projectId) === headRepo) threads.push(thread)
      }
      const branch = data.pull.head.ref
      const authored =
        data.viewer !== undefined &&
        data.viewer.login.toLowerCase() === data.pull.user.login.toLowerCase()
      const thread =
        threads.find((each) => each.worktree?.branch === branch || each.git?.branch === branch) ??
        (authored ? threads[0] : undefined)
      return thread
    })
  }

  // Runs inside the transaction that tells the thread, so the news leaves the PR rows exactly
  // when it reaches the chat. Switches turned off while it waited drop their part, a PR unlinked
  // from the thread meanwhile drops all of it, and one closed or merged meanwhile wakes no one.
  function take(threadId: string) {
    return Effect.gen(function* () {
      const now = Date.now()
      const settings = yield* store.getAgentBehaviours()
      const lines: PullRequestNews['lines'] = []
      const sections: string[] = []
      for (const { repo, number, memory } of yield* store.pendingPullRequestWatches()) {
        if (memory.pending?.threadId !== threadId) continue
        const linked = (yield* store.threadsForPullRequest(repo, number)).includes(threadId)
        const { data } = yield* store.getPullRequest(repo, number)
        const open = data?.pull.state === 'open' && !data.pull.merged
        const changes = memory.pending.changes.filter(
          (change) =>
            linked &&
            settings.watchPullRequests &&
            (!change.group || settings[change.group]) &&
            (open || !change.wakes)
        )
        const recent = (memory.wakes ?? []).filter((at) => now - at < HOUR_MS)
        const wakeful = changes.some((change) => change.wakes)
        const held = wakeful && recent.length >= WAKES_PER_HOUR
        if (wakeful && !held && data) {
          recent.push(now)
          const title = data.pull.title.replace(/[[\]]/g, '\\$&')
          const body = changes.map((change) => change.text).join('\n')
          sections.push(
            `New activity on your pull request [#${number} ${title}](${data.pull.html_url}):\n${
              body.length > SECTION_CAP
                ? `${body.slice(0, SECTION_CAP)}\n[Cut here; the pull request has the rest.]`
                : body
            }`
          )
        }
        yield* store.savePullRequestWatch(repo, number, {
          ...memory,
          wakes: recent,
          pending: undefined,
        })
        if (changes.length)
          lines.push({
            repo,
            number,
            activity: fold(changes.map((change) => change.activity)),
            ...(held && { held: true }),
          })
      }
      return { lines, text: sections.length ? sections.join('\n\n') : null }
    })
  }

  function arm(threadId: string, first: number, retries = 0) {
    const armed = timers.get(threadId)
    clearTimeout(armed?.timer)
    const start = Math.min(armed?.first ?? first, first)
    const timer = setTimeout(
      () => {
        timers.delete(threadId)
        void Effect.runPromise(orchestrator.pullRequestActivity(threadId, take(threadId))).catch(
          (error: unknown) => {
            console.warn(`[pr-watch] ${threadId} ${String(error)}`)
            if (!timers.has(threadId)) arm(threadId, start, Math.min(retries + 1, 3))
          }
        )
      },
      retries
        ? Math.min(MAX_WAIT_MS, QUIET_MS * 2 ** (retries - 1))
        : Math.max(0, Math.min(QUIET_MS, start + MAX_WAIT_MS - Date.now()))
    )
    timer.unref()
    timers.set(threadId, { first: start, timer })
  }

  return {
    // News a restart left waiting goes out on its old schedule.
    resume: Effect.gen(function* () {
      for (const { memory } of yield* store.pendingPullRequestWatches())
        if (memory.pending) arm(memory.pending.threadId, memory.pending.first)
    }),
    // Whether PR reads should pass their previous snapshot to changed.
    watching: store.getAgentBehaviours().pipe(Effect.map((settings) => settings.watchPullRequests)),
    observed(ref: PullRequestRef) {
      return Effect.gen(function* () {
        if (!(yield* store.getAgentBehaviours()).watchPullRequests) return
        const memory = yield* store.pullRequestWatch(ref.repo, ref.number)
        yield* store.savePullRequestWatch(ref.repo, ref.number, {
          ...memory,
          observedAt: Date.now(),
        })
      }).pipe(store.transaction)
    },
    changed(ref: PullRequestRef, previous: PullRequestSnapshot, next: PullRequestData) {
      return Effect.gen(function* () {
        if (!previous.data) return
        const settings = yield* store.getAgentBehaviours()
        if (!settings.watchPullRequests) return
        const saved = yield* store.pullRequestWatch(ref.repo, ref.number)
        const now = Date.now()
        const memory = { ...saved, observedAt: now }
        if (now - Math.max(saved.observedAt ?? 0, previous.dataRefreshedAt ?? 0) > STALE_MS) {
          yield* store.savePullRequestWatch(ref.repo, ref.number, memory)
          return
        }
        const seen = new Set(memory.fired)
        const detected = pullRequestChanges(
          previous.data,
          next,
          Math.max((previous.dataRefreshedAt ?? 0) - LATE_MS, now - STALE_MS),
          memory.failing ?? false,
          memory.checkEpisode ?? 0
        )
        if (detected.some((change) => change.activity.type === 'checks_failed'))
          memory.checkEpisode = (memory.checkEpisode ?? 0) + 1
        const changes = detected.filter(
          (change) =>
            (!change.group || settings[change.group]) && change.keys.some((each) => !seen.has(each))
        )
        const failing =
          rollupChecks[next.checkRollupState ?? ''] !== 'success' &&
          (memory.failing || changes.some((change) => change.activity.type === 'checks_failed'))
        const thread = changes.length ? yield* owner(ref, next) : undefined
        if (!thread) {
          yield* store.savePullRequestWatch(ref.repo, ref.number, {
            ...memory,
            failing: failing || undefined,
          })
          return
        }
        for (const change of changes) for (const each of change.keys) seen.add(each)
        const first = memory.pending?.first ?? Date.now()
        yield* store.savePullRequestWatch(ref.repo, ref.number, {
          ...memory,
          fired: [...seen].slice(-200),
          failing: failing || undefined,
          pending: {
            threadId: thread.id,
            first,
            changes: [...(memory.pending?.changes ?? []), ...changes],
          },
        })
        arm(thread.id, first)
      })
    },
  }
}

export type PullRequestWatch = ReturnType<typeof createPullRequestWatch>

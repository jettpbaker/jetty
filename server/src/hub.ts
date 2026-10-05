import type { GitHubActivity } from '@jetty/shared/pull-request'
import type { ThreadUpdate } from '@jetty/shared/rpc'
import type {
  BackgroundTask,
  ThreadMeta,
  ChromePushData,
  PullRequestList,
  PullRequestListTab,
  PullRequestSnapshot,
  RunningSubagent,
  WireError,
} from '@jetty/shared/wire'

import { backgroundStatus, deliversQueue } from '@jetty/shared/wire'
import { Effect, Queue, Semaphore } from 'effect'

export type Hub = ReturnType<typeof createHub>

// The closest attention any of them pays.
export function closestActivity(values: readonly GitHubActivity[]): GitHubActivity {
  return values.includes('focused') ? 'focused' : values.includes('blurred') ? 'blurred' : 'hidden'
}

export function createHub() {
  const threads = new Map<string, ThreadMeta>()
  const children = new Map<string, Set<string>>()
  const backgroundTasks = new Map<string, readonly BackgroundTask[]>()
  const runningSubagents = new Map<string, readonly RunningSubagent[]>()

  function decorateThread(thread: ThreadMeta): ThreadMeta {
    const tasks = backgroundTasks.get(thread.id) ?? []
    const waitingForChildren = [...(children.get(thread.id) ?? [])].some((id) => {
      const child = threads.get(id)
      // A child waiting on this thread's answer isn't something this thread waits for.
      if (!child || child.archived || child.awaitingParent) return false
      const status = decorateThread(child).status
      return (
        status === 'starting' ||
        status === 'running' ||
        status === 'monitoring' ||
        status === 'awaiting_approval'
      )
    })
    const subagents = runningSubagents.get(thread.id)
    return {
      ...thread,
      backgroundTasks: tasks,
      // Absent when none run, so chrome stays the same size for most threads.
      ...(subagents && { runningSubagents: subagents }),
      waitingForChildren,
      status: backgroundStatus(
        thread.status,
        tasks,
        waitingForChildren || thread.awaitingParent === true,
        deliversQueue(thread)
      ),
    }
  }

  function forgetThread(threadId: string) {
    const parentId = threads.get(threadId)?.parentThreadId
    if (parentId) {
      const siblings = children.get(parentId)
      siblings?.delete(threadId)
      if (!siblings?.size) children.delete(parentId)
    }
    threads.delete(threadId)
  }

  function rememberThread(thread: ThreadMeta) {
    forgetThread(thread.id)
    threads.set(thread.id, thread)
    if (thread.parentThreadId) {
      const siblings = children.get(thread.parentThreadId) ?? new Set<string>()
      siblings.add(thread.id)
      children.set(thread.parentThreadId, siblings)
    }
  }

  function setThreads(values: readonly ThreadMeta[]) {
    threads.clear()
    children.clear()
    for (const thread of values) rememberThread(thread)
  }

  const chromePublication = Semaphore.makeUnsafe(1)
  const chromeSubs = new Set<Queue.Queue<ChromePushData, WireError>>()
  // Each window reports its attention on a stream of its own, so a focus change never
  // resubscribes its chrome, PR or list streams. Until it reports, it counts as focused.
  const clientActivities = new Map<number, { token: symbol; activity: GitHubActivity }>()
  const githubWatchers = new Map<symbol, number>()

  function watchClientActivity(client: number, activity: GitHubActivity) {
    const token = Symbol()
    return Effect.acquireRelease(
      Effect.sync(() => clientActivities.set(client, { token, activity })),
      () =>
        Effect.sync(() => {
          if (clientActivities.get(client)?.token === token) clientActivities.delete(client)
        })
    )
  }

  function clientActivity(client: number): GitHubActivity {
    return clientActivities.get(client)?.activity ?? 'focused'
  }

  function watchGithubActivity(client: number) {
    const token = Symbol()
    return Effect.acquireRelease(
      Effect.sync(() => githubWatchers.set(token, client)),
      () => Effect.sync(() => githubWatchers.delete(token))
    )
  }

  function githubActivity() {
    return closestActivity([...githubWatchers.values()].map(clientActivity))
  }
  const threadSubs = new Map<string, Set<Queue.Queue<ThreadUpdate, WireError>>>()
  const pullRequestSubs = new Map<string, Set<Queue.Queue<PullRequestSnapshot, WireError>>>()
  const pullRequestListSubs = new Map<
    PullRequestListTab,
    Set<Queue.Queue<PullRequestList, WireError>>
  >()

  function offerChrome(data: ChromePushData) {
    for (const queue of chromeSubs) Queue.offerUnsafe(queue, data)
  }

  function pushChrome(data: ChromePushData) {
    let parentId: string | undefined
    if (data.type === 'thread.upserted') {
      rememberThread(data.thread)
      parentId = data.thread.parentThreadId
      data = { ...data, thread: decorateThread(data.thread) }
    } else if (data.type === 'thread.removed') {
      parentId = threads.get(data.threadId)?.parentThreadId
      forgetThread(data.threadId)
      backgroundTasks.delete(data.threadId)
      runningSubagents.delete(data.threadId)
    }
    offerChrome(data)
    while (parentId) {
      const parent = threads.get(parentId)
      if (!parent) break
      offerChrome({ type: 'thread.upserted', thread: decorateThread(parent) })
      parentId = parent.parentThreadId
    }
  }

  function pushThread(threadId: string, update: Extract<ThreadUpdate, { type: 'event' }>) {
    const subs = threadSubs.get(threadId)
    if (!subs) return
    for (const queue of subs) Queue.offerUnsafe(queue, update)
  }

  function subscribeChrome() {
    return Effect.acquireRelease(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ChromePushData, WireError>()
        chromeSubs.add(queue)
        return queue
      }),
      (queue) =>
        Effect.sync(() => chromeSubs.delete(queue)).pipe(Effect.andThen(Queue.shutdown(queue)))
    )
  }

  function subscribeThread(threadId: string) {
    return Effect.acquireRelease(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ThreadUpdate, WireError>()
        let subs = threadSubs.get(threadId)
        if (!subs) {
          subs = new Set()
          threadSubs.set(threadId, subs)
        }
        subs.add(queue)
        return queue
      }),
      (queue) =>
        Effect.sync(() => {
          const subs = threadSubs.get(threadId)
          subs?.delete(queue)
          if (subs?.size === 0) threadSubs.delete(threadId)
        }).pipe(Effect.andThen(Queue.shutdown(queue)))
    )
  }

  function pushPullRequest(snapshot: PullRequestSnapshot) {
    for (const queue of pullRequestSubs.get(`${snapshot.repo}#${snapshot.number}`) ?? [])
      Queue.offerUnsafe(queue, snapshot)
  }

  function subscribePullRequest(repo: string, number: number) {
    const key = `${repo}#${number}`
    return Effect.acquireRelease(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<PullRequestSnapshot, WireError>()
        const subs = pullRequestSubs.get(key) ?? new Set()
        subs.add(queue)
        pullRequestSubs.set(key, subs)
        return queue
      }),
      (queue) =>
        Effect.sync(() => {
          const subs = pullRequestSubs.get(key)
          subs?.delete(queue)
          if (subs?.size === 0) pullRequestSubs.delete(key)
        }).pipe(Effect.andThen(Queue.shutdown(queue)))
    )
  }

  function pushPullRequestList(list: PullRequestList) {
    for (const queue of pullRequestListSubs.get(list.tab) ?? []) Queue.offerUnsafe(queue, list)
  }

  function subscribePullRequestList(tab: PullRequestListTab) {
    return Effect.acquireRelease(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<PullRequestList, WireError>()
        const subs = pullRequestListSubs.get(tab) ?? new Set()
        subs.add(queue)
        pullRequestListSubs.set(tab, subs)
        return queue
      }),
      (queue) =>
        Effect.sync(() => {
          const subs = pullRequestListSubs.get(tab)
          subs?.delete(queue)
          if (subs?.size === 0) pullRequestListSubs.delete(tab)
        }).pipe(Effect.andThen(Queue.shutdown(queue)))
    )
  }

  return {
    decorateThread,
    setThreads,
    watchClientActivity,
    clientActivity,
    watchGithubActivity,
    githubActivity,
    setBackgroundTasks(threadId: string, tasks: readonly BackgroundTask[]) {
      if (tasks.length) backgroundTasks.set(threadId, tasks)
      else backgroundTasks.delete(threadId)
    },
    // Whether the thread's running subagents changed, so chrome is pushed only when one starts or stops.
    setRunningSubagents(threadId: string, subagents: readonly RunningSubagent[]) {
      const key = (list: readonly RunningSubagent[] = []) =>
        list.map((agent) => `${agent.id}:${agent.title}`).join('\n')
      if (key(runningSubagents.get(threadId)) === key(subagents)) return false
      if (subagents.length) runningSubagents.set(threadId, subagents)
      else runningSubagents.delete(threadId)
      return true
    },
    withChromePublication: chromePublication.withPermit,
    pushChrome,
    pushThread,
    subscribeChrome,
    subscribeThread,
    pushPullRequest,
    subscribePullRequest,
    pushPullRequestList,
    subscribePullRequestList,
    subscriberCount: Effect.sync(
      () =>
        chromeSubs.size +
        [...threadSubs.values()].reduce((total, subs) => total + subs.size, 0) +
        [...pullRequestSubs.values()].reduce((total, subs) => total + subs.size, 0) +
        [...pullRequestListSubs.values()].reduce((total, subs) => total + subs.size, 0)
    ),
  }
}

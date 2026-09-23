import type { ThreadUpdate } from '@jetty/shared/rpc'
import type { ChromePushData, PullRequestSnapshot, ThreadMeta, WireError } from '@jetty/shared/wire'

import { Effect, Queue, Semaphore } from 'effect'

export type Hub = ReturnType<typeof createHub>

export function createHub() {
  const chromePublication = Semaphore.makeUnsafe(1)
  const chromeSubs = new Set<Queue.Queue<ChromePushData, WireError>>()
  const threadSubs = new Map<string, Set<Queue.Queue<ThreadUpdate, WireError>>>()
  const pullRequestSubs = new Map<string, Set<Queue.Queue<PullRequestSnapshot, WireError>>>()

  function pushChrome(data: ChromePushData) {
    for (const queue of chromeSubs) Queue.offerUnsafe(queue, data)
  }

  function upsertThread<E, R>(load: Effect.Effect<ThreadMeta, E, R>) {
    return chromePublication.withPermit(
      load.pipe(
        Effect.tap((thread) => Effect.sync(() => pushChrome({ type: 'thread.upserted', thread })))
      )
    )
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

  return {
    withChromePublication: chromePublication.withPermit,
    upsertThread,
    pushChrome,
    pushThread,
    subscribeChrome,
    subscribeThread,
    pushPullRequest,
    subscribePullRequest,
    subscriberCount: Effect.sync(
      () =>
        chromeSubs.size +
        [...threadSubs.values()].reduce((total, subs) => total + subs.size, 0) +
        [...pullRequestSubs.values()].reduce((total, subs) => total + subs.size, 0)
    ),
  }
}

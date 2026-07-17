import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'

import type { Socket } from '../socket'

/** Max threads kept subscribed for background catch-up. Cache is never evicted. */
export const MAX_WARM_SUBSCRIPTIONS = 5

export type TimelineStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: (threadId: string) => ThreadState
  openThread: (threadId: string) => ThreadState
  closeThread: (threadId: string) => void
  getOpenThreadId: () => string | null
}

export function createTimelineStore(socket: Socket): TimelineStore {
  const cache = new Map<string, ThreadState>()
  /** Insertion-order LRU of held (subscribed) threads: oldest first, newest last. */
  const held = new Map<string, true>()
  let openThreadId: string | null = null
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  function setThread(threadId: string, next: ThreadState) {
    const prev = cache.get(threadId)
    if (prev === next) return
    cache.set(threadId, next)
    emit()
  }

  function subscribeThread(threadId: string) {
    const state = cache.get(threadId) ?? emptyThread
    void socket.request('thread.subscribe', { threadId, afterSeq: state.lastSeq }).catch(() => {
      // reconnect will retry
    })
  }

  function touchHeld(threadId: string) {
    held.delete(threadId)
    held.set(threadId, true)
    while (held.size > MAX_WARM_SUBSCRIPTIONS) {
      const oldest = held.keys().next().value
      if (oldest === undefined) break
      held.delete(oldest)
      void socket.request('thread.unsubscribe', { threadId: oldest }).catch(() => {
        // best-effort; cache kept
      })
    }
  }

  function resubscribeHeld() {
    for (const threadId of held.keys()) {
      subscribeThread(threadId)
    }
  }

  socket.onThreadPush((push) => {
    const prev = cache.get(push.threadId) ?? emptyThread
    const next = applyEvent(prev, {
      seq: push.seq,
      ts: push.ts,
      event: push.event,
    })
    setThread(push.threadId, next)
  })

  socket.onReconnect(resubscribeHeld)

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot(threadId) {
      return cache.get(threadId) ?? emptyThread
    },
    openThread(threadId) {
      if (!cache.has(threadId)) {
        cache.set(threadId, emptyThread)
      }
      const state = cache.get(threadId) ?? emptyThread
      openThreadId = threadId
      touchHeld(threadId)
      subscribeThread(threadId)
      return state
    },
    closeThread(threadId) {
      // Leave the subscription warm; only LRU eviction unsubscribes.
      if (openThreadId === threadId) {
        openThreadId = null
      }
    },
    getOpenThreadId() {
      return openThreadId
    },
  }
}

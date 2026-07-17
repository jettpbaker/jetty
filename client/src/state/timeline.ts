import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'

import type { Socket } from '../socket'

export type TimelineStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: (threadId: string) => ThreadState
  openThread: (threadId: string) => ThreadState
  closeThread: (threadId: string) => void
  getOpenThreadId: () => string | null
}

export function createTimelineStore(socket: Socket): TimelineStore {
  const cache = new Map<string, ThreadState>()
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

  function resubscribeOpen() {
    if (!openThreadId) return
    const state = cache.get(openThreadId) ?? emptyThread
    void socket
      .request('thread.subscribe', { threadId: openThreadId, afterSeq: state.lastSeq })
      .catch(() => {
        // reconnect will retry
      })
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

  socket.onReconnect(resubscribeOpen)

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
      void socket.request('thread.subscribe', { threadId, afterSeq: state.lastSeq }).catch(() => {
        // reconnect will retry
      })
      return state
    },
    closeThread(threadId) {
      if (openThreadId === threadId) {
        openThreadId = null
      }
      void socket.request('thread.unsubscribe', { threadId }).catch(() => {
        // best-effort; cache kept
      })
    },
    getOpenThreadId() {
      return openThreadId
    },
  }
}

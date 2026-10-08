import type { WaitedThread } from '@jetty/shared/bots'
import type { ThreadState } from '@jetty/shared/reducer'
import type { ThreadMeta } from '@jetty/shared/wire'

import { WAIT_NOTES } from '@jetty/shared/bots'
import { heldByRestarts } from '@jetty/shared/items'

export type ChildWaitResult = WaitedThread extends infer Result
  ? Result extends WaitedThread
    ? Omit<Result, 'threadId' | 'link' | 'created'>
    : never
  : never

export function needsUser(thread: ThreadMeta, state: ThreadState) {
  return (
    state.status === 'awaiting_approval' ||
    thread.worktree?.state === 'failed' ||
    heldByRestarts(state.items) ||
    state.items.some(
      (item) =>
        (item.kind === 'question' && !item.answers && !item.dismissed) ||
        (item.kind === 'approval' && !item.decision) ||
        (item.kind === 'error' && item.turnId === state.activeTurnId)
    )
  )
}

export function createChildWaits() {
  const versions = new Map<string, number>()
  const version = (parentId: string) => versions.get(parentId) ?? 0
  const waiting = new Map<string, { parentId: string; finish: (result: ChildWaitResult) => void }>()
  const running = { status: 'running', detail: WAIT_NOTES.running } as const

  function finish(threadId: string, result: ChildWaitResult) {
    waiting.get(threadId)?.finish(result)
  }

  function wait(
    threadId: string,
    parentId: string,
    capMs: number,
    signal: AbortSignal,
    expectedVersion = version(parentId)
  ) {
    return new Promise<ChildWaitResult>((resolve) => {
      function done(result: ChildWaitResult) {
        clearTimeout(timer)
        signal.removeEventListener('abort', cancel)
        waiting.delete(threadId)
        resolve(result)
      }
      function cancel() {
        done(running)
      }
      const timer = setTimeout(cancel, capMs)
      waiting.set(threadId, { parentId, finish: done })
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted || version(parentId) !== expectedVersion) cancel()
    })
  }

  function message(parentId: string) {
    versions.set(parentId, version(parentId) + 1)
    for (const entry of waiting.values()) if (entry.parentId === parentId) entry.finish(running)
  }

  function close() {
    for (const entry of waiting.values()) entry.finish(running)
  }

  return { wait, finish, message, close, version, has: (threadId: string) => waiting.has(threadId) }
}

import type { Connection } from '@/net/connection'
import type { QueuedMessage } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { newId } from '@jetty/shared/wire'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'
import { useMemo } from 'react'

import { useChrome } from './chrome'
import { run, useAction } from './connection'
import { without } from './mutations'

type Registry = AtomRegistry.AtomRegistry

type QueueOp =
  | { kind: 'add'; message: QueuedMessage }
  | { kind: 'remove'; id: string }
  | { kind: 'edit'; id: string; text: string }

const noMessages: readonly QueuedMessage[] = []

// Each op overlays the server queue until its request settles; the server publishes the
// new queue before replying, so the handover has no gap.
const queueOpsAtom = Atom.make<ReadonlyMap<string, readonly QueueOp[]>>(new Map()).pipe(
  Atom.keepAlive
)

function applyOps(queue: readonly QueuedMessage[], ops: readonly QueueOp[]) {
  let list = queue
  for (const op of ops) {
    if (op.kind === 'add') {
      if (!list.some((message) => message.id === op.message.id)) list = [...list, op.message]
    } else if (op.kind === 'remove') list = list.filter((message) => message.id !== op.id)
    else
      list = list.map((message) => (message.id === op.id ? { ...message, text: op.text } : message))
  }
  return list
}

function track(
  registry: Registry,
  threadId: string,
  op: QueueOp,
  request: (connection: Connection) => Effect.Effect<unknown, unknown>
) {
  registry.update(queueOpsAtom, (ops) =>
    new Map(ops).set(threadId, [...(ops.get(threadId) ?? []), op])
  )
  const settle = Effect.sync(() =>
    registry.update(queueOpsAtom, (ops) => {
      const left = (ops.get(threadId) ?? []).filter((entry) => entry !== op)
      return left.length ? new Map(ops).set(threadId, left) : without(ops, [threadId])
    })
  )
  run(registry, (connection) => request(connection).pipe(Effect.ensuring(settle)))
}

function addQueued(registry: Registry, threadId: string, text: string) {
  const message = { id: newId(), text, createdAt: Date.now(), hop: 0 }
  track(registry, threadId, { kind: 'add', message }, (connection) =>
    connection.request('queue.add', { threadId, messageId: message.id, text })
  )
}

function removeQueued(registry: Registry, threadId: string, messageId: string) {
  track(registry, threadId, { kind: 'remove', id: messageId }, (connection) =>
    connection.request('queue.remove', { threadId, messageId })
  )
}

function editQueued(registry: Registry, threadId: string, messageId: string, text: string) {
  track(registry, threadId, { kind: 'edit', id: messageId, text }, (connection) =>
    connection.request('queue.edit', { threadId, messageId, text })
  )
}

function steerQueued(registry: Registry, threadId: string, messageId: string) {
  track(registry, threadId, { kind: 'remove', id: messageId }, (connection) =>
    connection.request('queue.sendNow', { threadId, messageId })
  )
}

export function useThreadQueue(threadId: string | undefined) {
  const server = useChrome()?.threads.find((thread) => thread.id === threadId)?.pendingMessages
  const ops = useAtomValue(queueOpsAtom).get(threadId ?? '')
  return useMemo(() => applyOps(server ?? noMessages, ops ?? []), [ops, server])
}

export function useQueueActions() {
  return {
    add: useAction(addQueued),
    remove: useAction(removeQueued),
    edit: useAction(editQueued),
    steer: useAction(steerQueued),
  }
}

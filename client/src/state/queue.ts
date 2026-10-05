import type { ReadyImage } from '@/hooks/use-image-attachments'
import type { Connection } from '@/net/connection'
import type { QueuedMessage } from '@jetty/shared/wire'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { newId } from '@jetty/shared/wire'
import { Effect, Exit, Fiber } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useContext, useEffect, useMemo } from 'react'
import { toast } from 'sonner'

import { chromeAtom, useChrome } from './chrome'
import { run, useAction } from './connection'
import { editingDrafts, stageSend } from './drafts'
import { unarchiveFirst, without } from './mutations'
import { showSent } from './turns'

type Registry = AtomRegistry.AtomRegistry

type QueueOp =
  | { kind: 'add'; message: QueuedMessage }
  | { kind: 'remove'; id: string }
  | { kind: 'edit'; id: string; text: string }

const noMessages: readonly QueuedMessage[] = []

// Each op overlays the server queue until the queue shows it. The server publishes the new
// queue before replying, but the reply can still reach the client first.
const queueOpsAtom = Atom.make<ReadonlyMap<string, readonly QueueOp[]>>(new Map()).pipe(
  Atom.keepAlive
)

function shows(queue: readonly QueuedMessage[], op: QueueOp) {
  if (op.kind === 'add') return queue.some((message) => message.id === op.message.id)
  const entry = queue.find((message) => message.id === op.id)
  return op.kind === 'remove' ? !entry : !entry || entry.text === op.text
}

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
  request: (connection: Connection) => Effect.Effect<unknown, unknown>,
  settled?: { onSuccess?: () => void; onFailure?: () => void }
) {
  registry.update(queueOpsAtom, (ops) =>
    new Map(ops).set(threadId, [...(ops.get(threadId) ?? []), op])
  )
  function drop() {
    registry.update(queueOpsAtom, (ops) => {
      const left = (ops.get(threadId) ?? []).filter((entry) => entry !== op)
      return left.length ? new Map(ops).set(threadId, left) : without(ops, [threadId])
    })
  }
  function dropWhenShown() {
    const shown = () =>
      shows(
        registry.get(chromeAtom)?.threads.find((thread) => thread.id === threadId)
          ?.pendingMessages ?? noMessages,
        op
      )
    if (shown()) return drop()
    const timer = setTimeout(done, 5000)
    const stop = registry.subscribe(chromeAtom, () => {
      if (shown()) done()
    })
    function done() {
      clearTimeout(timer)
      stop()
      drop()
    }
  }
  return run(registry, (connection) =>
    request(connection).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit)) {
            dropWhenShown()
            settled?.onSuccess?.()
          } else {
            drop()
            settled?.onFailure?.()
          }
        })
      )
    )
  )
}

// In-flight adds by message id, and each thread's latest add.
const adding = new Map<string, Fiber.Fiber<unknown, unknown>>()
const latestAdd = new Map<string, Fiber.Fiber<unknown, unknown>>()

// A remove, edit or send-now on a message still being added waits for the add, or the server
// wouldn't know the message yet and the add would land after it.
function awaitAdd(messageId: string) {
  return awaitFiber(adding.get(messageId))
}

function awaitFiber(fiber: Fiber.Fiber<unknown, unknown> | undefined) {
  return fiber ? Fiber.join(fiber).pipe(Effect.ignore) : Effect.void
}

function isArchived(registry: Registry, threadId: string) {
  return registry.get(chromeAtom)?.threads.find((thread) => thread.id === threadId)?.archived
}

function addQueued(
  registry: Registry,
  threadId: string,
  text: string,
  images: readonly ReadyImage[] = []
) {
  const message = {
    id: newId(),
    text,
    createdAt: Date.now(),
    hop: 0,
    attachments: images.map(({ url, name, mimeType, sizeBytes, width, height }) => ({
      id: url,
      name,
      mimeType,
      sizeBytes,
      width,
      height,
    })),
  }
  const unarchive = unarchiveFirst(registry, threadId, isArchived(registry, threadId))
  const staged = stageSend(registry, threadId, { text, images })
  // Adds go out one at a time per thread, so a message whose images take a while to store still
  // reaches the queue before a text-only one sent after it.
  const previous = latestAdd.get(threadId)
  const add = track(
    registry,
    threadId,
    { kind: 'add', message },
    (connection) =>
      awaitFiber(previous).pipe(
        Effect.andThen(unarchive(connection)),
        Effect.andThen(
          connection.request('queue.add', {
            threadId,
            messageId: message.id,
            text,
            ...(images.length > 0
              ? {
                  attachments: images.map(({ name, mimeType, dataUrl }) => ({
                    name,
                    mimeType,
                    dataUrl,
                  })),
                }
              : {}),
          })
        )
      ),
    {
      onSuccess() {
        staged.sent()
        for (const image of images) URL.revokeObjectURL(image.url)
      },
      onFailure() {
        staged.failed(threadId)
        toast.error("Couldn't queue message")
      },
    }
  )
  adding.set(message.id, add)
  latestAdd.set(threadId, add)
  add.addObserver(() => {
    adding.delete(message.id)
    if (latestAdd.get(threadId) === add) latestAdd.delete(threadId)
  })
}

function removeQueued(registry: Registry, threadId: string, messageId: string) {
  track(registry, threadId, { kind: 'remove', id: messageId }, (connection) =>
    awaitAdd(messageId).pipe(
      Effect.andThen(connection.request('queue.remove', { threadId, messageId }))
    )
  )
}

function editQueued(registry: Registry, threadId: string, messageId: string, text: string) {
  const staged = stageSend(registry, threadId, { text, images: [], editing: messageId })
  track(
    registry,
    threadId,
    { kind: 'edit', id: messageId, text },
    (connection) =>
      awaitAdd(messageId).pipe(
        Effect.andThen(connection.request('queue.edit', { threadId, messageId, text }))
      ),
    {
      onSuccess: staged.sent,
      onFailure() {
        staged.failed(threadId)
        if (
          editingDrafts(registry).some(([id, editing]) => id === threadId && editing === messageId)
        )
          holdQueued(registry, threadId, messageId)
        toast.error("Couldn't save edit")
      },
    }
  )
}

function sendQueuedNow(registry: Registry, threadId: string, message: QueuedMessage) {
  const unarchive = unarchiveFirst(registry, threadId, isArchived(registry, threadId))
  const settle = showSent(registry, threadId, {
    id: message.id,
    text: message.text,
    images: message.attachments ?? [],
    sentAt: Date.now(),
  })
  run(
    registry,
    (connection) =>
      unarchive(connection).pipe(
        Effect.andThen(awaitAdd(message.id)),
        Effect.andThen(connection.request('queue.sendNow', { threadId, messageId: message.id }))
      ),
    () => {
      settle()
      toast.error("Couldn't send message")
    }
  )
}

function holdQueued(registry: Registry, threadId: string, messageId: string) {
  run(registry, (connection) =>
    awaitAdd(messageId).pipe(
      Effect.andThen(connection.request('queue.hold', { threadId, messageId }))
    )
  )
}

function releaseQueued(registry: Registry, threadId: string, messageId: string) {
  run(registry, (connection) =>
    awaitAdd(messageId).pipe(
      Effect.andThen(connection.request('queue.release', { threadId, messageId }))
    )
  )
}

// The server releases an edit hold after 60s, so renew every draft's hold from here rather than
// from its composer, which unmounts when the user switches threads mid-edit. A reload brings
// its drafts back, so their holds are taken again straight away, before the lease runs out.
export function useRenewQueueHolds() {
  const registry = useContext(RegistryContext)
  useEffect(() => {
    for (const [threadId, messageId] of editingDrafts(registry))
      holdQueued(registry, threadId, messageId)
    const timer = setInterval(() => {
      const threads = registry.get(chromeAtom)?.threads
      for (const [threadId, messageId] of editingDrafts(registry))
        if (
          threads
            ?.find((thread) => thread.id === threadId)
            ?.pendingMessages?.some((message) => message.id === messageId)
        )
          holdQueued(registry, threadId, messageId)
    }, 30_000)
    return () => clearInterval(timer)
  }, [registry])
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
    sendNow: useAction(sendQueuedNow),
    hold: useAction(holdQueued),
    release: useAction(releaseQueued),
  }
}

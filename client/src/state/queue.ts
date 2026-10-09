import type { ReadyAttachment } from '@/hooks/use-attachments'
import type { Reply, ThreadItem } from '@jetty/shared/items'
import type { QueuedMessage } from '@jetty/shared/wire'

import { revokeBlobUrl } from '@/lib/blob_urls'
import { resendOnDrop, type Connection } from '@/net/connection'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { newId } from '@jetty/shared/wire'
import { Effect, Equal, Exit, Fiber } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { chromeAtom, threadMetaAtom } from './chrome'
import { run, useAction } from './connection'
import { editingDrafts, stageSend } from './drafts'
import { unarchiveFirst, without } from './mutations'
import { createQueueRequests } from './queue_requests'
import { showSent, useSendingIds } from './turns'

type Registry = AtomRegistry.AtomRegistry

type QueueOp =
  | { kind: 'add'; message: QueuedMessage }
  | { kind: 'restore'; message: QueuedMessage; index: number }
  | { kind: 'remove'; id: string }
  | { kind: 'edit'; id: string; text: string }

const noMessages: readonly QueuedMessage[] = []

// Each op overlays the server queue until the queue shows it. The server publishes the new
// queue before replying, but the reply can still reach the client first.
const queueOpsAtom = Atom.make<ReadonlyMap<string, readonly QueueOp[]>>(new Map()).pipe(
  Atom.keepAlive
)

function shows(queue: readonly QueuedMessage[], op: QueueOp) {
  if (op.kind === 'add' || op.kind === 'restore')
    return queue.some((message) => message.id === op.message.id)
  const entry = queue.find((message) => message.id === op.id)
  return op.kind === 'remove' ? !entry : !entry || entry.text === op.text
}

function applyOps(queue: readonly QueuedMessage[], ops: readonly QueueOp[]) {
  let list = queue
  for (const op of ops) {
    if (op.kind === 'add' || op.kind === 'restore') {
      const at = op.kind === 'add' ? list.length : op.index
      if (!list.some((message) => message.id === op.message.id))
        list = [...list.slice(0, at), op.message, ...list.slice(at)]
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
  return runQueued(registry, threadId, 'message' in op ? op.message.id : op.id, (connection) =>
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

const queueRequests = createQueueRequests()
const latestAdd = new Map<string, Fiber.Fiber<unknown, unknown>>()

function runQueued<A, E>(
  registry: Registry,
  threadId: string,
  messageId: string,
  request: (connection: Connection) => Effect.Effect<A, E>,
  onFailure?: () => void
) {
  return queueRequests(threadId, messageId, (wait) =>
    run(registry, (connection) => wait.pipe(Effect.andThen(request(connection))), onFailure)
  )
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
  attachments: readonly ReadyAttachment[] = [],
  replies?: readonly Reply[]
) {
  const message = {
    id: newId(),
    text,
    ...(replies?.length && { replies }),
    createdAt: Date.now(),
    hop: 0,
    attachments: attachments.map(({ url, name, mimeType, sizeBytes, width, height }) => ({
      id: url,
      name,
      mimeType,
      sizeBytes,
      width,
      height,
    })),
  }
  const unarchive = unarchiveFirst(registry, threadId, isArchived(registry, threadId))
  const staged = stageSend(registry, threadId, {
    text,
    attachments,
    quotes: replies,
    sent: { threadId, messageId: message.id },
  })
  // Adds go out one at a time per thread, so a message whose attachments take a while to store still
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
          resendOnDrop(
            connection.request('queue.add', {
              threadId,
              messageId: message.id,
              text,
              ...(replies?.length && { replies }),
              ...(attachments.length > 0
                ? {
                    attachments: attachments.map(({ name, mimeType, dataUrl }) => ({
                      name,
                      mimeType,
                      dataUrl,
                    })),
                  }
                : {}),
            })
          )
        )
      ),
    {
      onSuccess() {
        staged.sent()
        for (const attachment of attachments) revokeBlobUrl(attachment.url)
      },
      onFailure() {
        staged.failed(threadId)
        toast.error("Couldn't queue message")
      },
    }
  )
  latestAdd.set(threadId, add)
  add.addObserver(() => {
    if (latestAdd.get(threadId) === add) latestAdd.delete(threadId)
  })
}

function currentQueue(registry: Registry, threadId: string) {
  return applyOps(
    registry.get(chromeAtom)?.threads.find((thread) => thread.id === threadId)?.pendingMessages ??
      noMessages,
    registry.get(queueOpsAtom).get(threadId) ?? []
  )
}

type Removed = { message: QueuedMessage; index: number }

// Each thread's last removed message, offered back with Undo for a few seconds; the server keeps
// it a while longer, so an Undo pressed at the last moment still lands.
const removedAtom = Atom.make<ReadonlyMap<string, Removed>>(new Map()).pipe(Atom.keepAlive)
const undoMs = 6000

function removeQueued(registry: Registry, threadId: string, messageId: string) {
  const queue = currentQueue(registry, threadId)
  const index = queue.findIndex((message) => message.id === messageId)
  if (index !== -1) {
    const removed = { message: queue[index]!, index }
    registry.update(removedAtom, (map) => new Map(map).set(threadId, removed))
    setTimeout(() => {
      registry.update(removedAtom, (map) =>
        map.get(threadId) === removed ? without(map, [threadId]) : map
      )
    }, undoMs)
  }
  track(registry, threadId, { kind: 'remove', id: messageId }, (connection) =>
    connection.request('queue.remove', { threadId, messageId })
  )
}

function restoreQueued(registry: Registry, threadId: string) {
  const removed = registry.get(removedAtom).get(threadId)
  if (!removed) return
  registry.update(removedAtom, (map) => without(map, [threadId]))
  const { message, index } = removed
  track(
    registry,
    threadId,
    { kind: 'restore', message, index },
    (connection) => connection.request('queue.restore', { threadId, messageId: message.id }),
    { onFailure: () => toast.error("Couldn't put the message back") }
  )
}

function editQueued(registry: Registry, threadId: string, messageId: string, text: string) {
  const staged = stageSend(registry, threadId, { text, attachments: [], editing: messageId })
  track(
    registry,
    threadId,
    { kind: 'edit', id: messageId, text },
    (connection) => connection.request('queue.edit', { threadId, messageId, text }),
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
  // Only the user's own message shows as sent at once; another thread's waits for the server's
  // copy, which carries its source.
  const settle = message.from
    ? undefined
    : showSent(registry, threadId, {
        id: message.id,
        text: message.text,
        attachments: message.attachments ?? [],
        sentAt: Date.now(),
      })
  runQueued(
    registry,
    threadId,
    message.id,
    (connection) =>
      unarchive(connection).pipe(
        Effect.andThen(connection.request('queue.sendNow', { threadId, messageId: message.id }))
      ),
    () => {
      settle?.()
      // A worktree setup that failed or was stopped says so above the composer.
      const worktree = registry
        .get(chromeAtom)
        ?.threads.find((entry) => entry.id === threadId)?.worktree
      if (!worktree || worktree.state === 'ready') toast.error("Couldn't send message")
    }
  )
}

function holdQueued(registry: Registry, threadId: string, messageId: string) {
  runQueued(registry, threadId, messageId, (connection) =>
    connection.request('queue.hold', { threadId, messageId })
  )
}

function releaseQueued(registry: Registry, threadId: string, messageId: string) {
  runQueued(registry, threadId, messageId, (connection) =>
    connection.request('queue.release', { threadId, messageId })
  )
}

// The server releases an edit hold after 60s, so renew every draft's hold from here rather than
// from its composer, which unmounts when the user switches threads mid-edit. A reload brings
// its drafts back, so their holds are taken again straight away, before the lease runs out.
// A hidden tab's timer can run as rarely as once a minute, so coming back renews at once too.
export function useRenewQueueHolds() {
  const registry = useContext(RegistryContext)
  useEffect(() => {
    for (const [threadId, messageId] of editingDrafts(registry))
      holdQueued(registry, threadId, messageId)
    function renew() {
      const threads = registry.get(chromeAtom)?.threads
      for (const [threadId, messageId] of editingDrafts(registry))
        if (
          threads
            ?.find((thread) => thread.id === threadId)
            ?.pendingMessages?.some((message) => message.id === messageId)
        )
          holdQueued(registry, threadId, messageId)
    }
    function onVisible() {
      if (document.visibilityState === 'visible') renew()
    }
    const timer = setInterval(renew, 30_000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [registry])
}

// Per thread and by value, so a chrome update that leaves this thread's queue as it was (each
// status change brings a fresh copy) doesn't rebuild the chat's rows.
const pendingMessagesAtom = Atom.family((threadId: string) =>
  Atom.make((get) => get(threadMetaAtom(threadId))?.pendingMessages).pipe(
    Atom.withEquality<readonly QueuedMessage[] | undefined>(
      (a, b) => (!a?.length && !b?.length) || Equal.equals(a, b)
    )
  )
)
const queueHeldAtom = Atom.family((threadId: string) =>
  Atom.make((get) => {
    const thread = get(threadMetaAtom(threadId))
    return Boolean(thread?.queuePaused || thread?.archived)
  })
)

// Whether the queue waits for the user: paused after a stop, a restart or a failed setup, or
// archived.
export function useQueueHeld(threadId: string | undefined) {
  return useAtomValue(queueHeldAtom(threadId ?? ''))
}

const threadQueueOpsAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => get(queueOpsAtom).get(threadId))
)
const threadRemovedAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => get(removedAtom).get(threadId))
)

export function useThreadQueue(threadId: string | undefined) {
  const server = useAtomValue(pendingMessagesAtom(threadId ?? ''))
  const ops = useAtomValue(threadQueueOpsAtom(threadId ?? ''))
  return useMemo(() => applyOps(server ?? noMessages, ops ?? []), [ops, server])
}

// The queue as the chat shows it: what's still waiting (a message already in the chat can stay
// queued until chrome catches up), and the user's own messages among it. Other threads' messages
// wait unseen.
export function useVisibleQueue(threadId: string | undefined, items: readonly ThreadItem[]) {
  const queued = useThreadQueue(threadId)
  const sending = useSendingIds(threadId)
  return useMemo(() => {
    if (queued.length === 0) return { queued, unsent: queued, own: queued }
    const shown = new Set(sending)
    for (const item of items) if (item.kind === 'user_message') shown.add(item.id)
    const unsent = queued.filter((entry) => !shown.has(entry.id))
    return { queued, unsent, own: unsent.filter((entry) => !entry.from) }
  }, [items, queued, sending])
}

export function useRemovedQueued(threadId: string | undefined) {
  return useAtomValue(threadRemovedAtom(threadId ?? ''))
}

// The thread's composer, as the chat reaches it: Edit loads a queued message into it, Add to
// prompt quotes a reply in it, and Steer and Remove hand keyboard focus back to it.
type ChatComposer = {
  edit: (entry: QueuedMessage) => void
  quote: (reply: Reply) => void
  keepFocus: () => void
}
const composers = new Map<string, ChatComposer>()

export function useChatComposer(threadId: string | undefined, composer: ChatComposer) {
  const latest = useRef(composer)
  useLayoutEffect(() => {
    latest.current = composer
  })
  useEffect(() => {
    if (!threadId) return
    const entry: ChatComposer = {
      edit: (message) => latest.current.edit(message),
      quote: (reply) => latest.current.quote(reply),
      keepFocus: () => latest.current.keepFocus(),
    }
    composers.set(threadId, entry)
    return () => {
      if (composers.get(threadId) === entry) composers.delete(threadId)
    }
  }, [threadId])
}

export function chatComposer(threadId: string) {
  return composers.get(threadId)
}

export function useQueueActions() {
  return {
    add: useAction(addQueued),
    remove: useAction(removeQueued),
    restore: useAction(restoreQueued),
    edit: useAction(editQueued),
    sendNow: useAction(sendQueuedNow),
    hold: useAction(holdQueued),
    release: useAction(releaseQueued),
  }
}

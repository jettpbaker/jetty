import type { ThreadItem } from '@jetty/shared/items'
import type { ThreadUpdate } from '@jetty/shared/rpc'

import { perf } from '@/perf'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { backgroundStatus } from '@jetty/shared/wire'
import { Effect, Stream } from 'effect'
import { AsyncResult, Atom, type AtomRegistry } from 'effect/reactivity'
import { useContext, useEffect, useRef } from 'react'

import { threadMetaAtom } from './chrome'
import { subscribe, useAction } from './connection'
import { createItemSelection, noteItemDelta, sameItems } from './item_selection'
import { awaitCreation } from './mutations'

function foldUpdate(state: ThreadState, update: ThreadUpdate): ThreadState {
  if (update.type === 'snapshot') return { ...update.snapshot, lastSeq: update.seq }
  if (update.type === 'event') {
    const next = applyEvent(state, update)
    if (update.event.type === 'item.delta')
      noteItemDelta(state.items, next.items, update.event.itemId)
    return next
  }
  return { ...state, lastSeq: Math.max(state.lastSeq, update.seq) }
}

// When this window saw items complete as it happened, by its own clock: a remote client's clock
// can be off the server's. Events that catch a subscription up don't count.
const completedHere = new Map<string, number>()

export function completedAgo(itemId: string) {
  const at = completedHere.get(itemId)
  return at === undefined ? Infinity : performance.now() - at
}

function noteCompleted(itemId: string) {
  completedHere.set(itemId, performance.now())
  if (completedHere.size > 200) completedHere.delete(completedHere.keys().next().value!)
}

const resumeAtom = Atom.family((_threadId: string) =>
  Atom.make<ThreadState | undefined>(undefined).pipe(Atom.setIdleTTL('10 minutes'))
)

// `get.once`, not `get`: a parent link would shorten resume's TTL by live's on sweep.
const liveAtom = Atom.family((threadId: string) =>
  Atom.make((get) => {
    const cached = get.once(resumeAtom(threadId))
    // A subscription catches up first; its snapshot or `ready` says the events after it are live.
    let live = false
    return subscribe(get, (connection) => {
      live = false
      return Stream.unwrap(
        Effect.as(awaitCreation(threadId), connection.subscribeThread(threadId, cached?.lastSeq))
      )
    }).pipe(
      Stream.tap((update) =>
        Effect.sync(() => {
          perf.threadUpdate(threadId, update)
          if (update.type !== 'event') live = true
          else if (live && update.event.type === 'item.completed')
            noteCompleted(update.event.itemId)
        })
      ),
      Stream.scan(() => cached ?? emptyThread, foldUpdate),
      Stream.drop(1),
      Stream.tap((state) => Effect.sync(() => get.set(resumeAtom(threadId), state)))
    )
  }).pipe(Atom.setIdleTTL('90 seconds'))
)

export const threadAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => {
    const resume = get(resumeAtom(threadId))
    const state = AsyncResult.getOrElse(get(liveAtom(threadId)), () => resume)
    const thread = get(threadMetaAtom(threadId))
    if (!state) return state
    const status = backgroundStatus(
      state.status,
      thread?.backgroundTasks ?? [],
      thread?.waitingForChildren || thread?.awaitingParent
    )
    return status === state.status ? state : { ...state, status }
  })
)

// A thread's state while it's loaded or cached, read without subscribing to it.
export function peekThread(
  registry: AtomRegistry.AtomRegistry,
  threadId: string
): ThreadState | undefined {
  const nodes = registry.getNodes()
  const live: AsyncResult.AsyncResult<ThreadState, unknown> | undefined = nodes
    .get(liveAtom(threadId))
    ?.value()
  if (live && AsyncResult.isSuccess(live)) return live.value
  return nodes.get(resumeAtom(threadId))?.value()
}

function startThreadJourney(registry: AtomRegistry.AtomRegistry, threadId: string) {
  const live = registry.getNodes().get(liveAtom(threadId))?.value()
  perf.threadClick(
    threadId,
    registry.get(resumeAtom(threadId)) !== undefined,
    live !== undefined && AsyncResult.isSuccess(live)
  )
}

export function useThreadJourney() {
  return useAction(startThreadJourney)
}

export function useThread(threadId: string): ThreadState | undefined {
  return useAtomValue(threadAtom(threadId))
}

// The context reading alone, so its readers skip the thread's other events.
const threadContextAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => get(threadAtom(threadId))?.context ?? null)
)

export function useThreadContext(threadId: string | undefined) {
  return useAtomValue(threadContextAtom(threadId ?? ''))
}

export const threadStatusAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => get(threadAtom(threadId))?.status)
)

const noItems: readonly ThreadItem[] = []
// The calls todo_model folds into the task list.
const todoTools = new Set(['TodoWrite', 'update_plan', 'TaskCreate', 'TaskUpdate'])

// What the Overview lists, so a streamed reply doesn't re-render it or replay its todos.
const overviewItemsAtom = Atom.family((threadId: string) => {
  const select = createItemSelection(
    (item) =>
      item.kind === 'subagent' ||
      item.kind === 'workflow' ||
      (item.kind === 'tool_call' && !item.agentId && todoTools.has(item.toolName))
  )
  return Atom.readable((get) => select(get(threadAtom(threadId))?.items ?? noItems)).pipe(
    Atom.withEquality(sameItems)
  )
})

// Todos finished in an earlier turn drop out, so the Overview needs the thread's last turn too.
const lastTurnAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => get(threadAtom(threadId))?.items.at(-1)?.turnId)
)

export function useOverviewItems(threadId: string) {
  return {
    items: useAtomValue(overviewItemsAtom(threadId)),
    lastTurn: useAtomValue(lastTurnAtom(threadId)),
  }
}

// Warms a hovered row's thread outside React, so hovering never re-renders the list. A warm
// that hasn't loaded yet outlives the hover until it has.
export function useThreadRowPrefetch() {
  const registry = useContext(RegistryContext)
  const hovering = useRef<string | undefined>(undefined)
  const warm = useRef<{ id: string; release: () => void } | undefined>(undefined)

  function settle() {
    const current = warm.current
    if (!current || current.id === hovering.current) return
    if (registry.get(threadAtom(current.id)) === undefined) return
    current.release()
    warm.current = undefined
  }

  useEffect(
    () => () => {
      warm.current?.release()
      warm.current = undefined
    },
    []
  )

  return {
    enter(id: string) {
      hovering.current = id
      if (warm.current?.id === id) return
      warm.current?.release()
      warm.current = { id, release: registry.subscribe(threadAtom(id), settle) }
      registry.get(threadAtom(id))
    },
    leave(id: string) {
      if (hovering.current !== id) return
      hovering.current = undefined
      settle()
    },
  }
}

import type { SequencedEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'
import type { ThreadUpdate } from '@jetty/shared/rpc'

import { perf } from '@/perf'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { summaryItems, type ThreadSnapshot as ThreadState } from '@jetty/shared/history'
import { emptyThread } from '@jetty/shared/reducer'
import { foldTodos } from '@jetty/shared/todos'
import { backgroundStatus } from '@jetty/shared/wire'
import { Effect, Stream } from 'effect'
import { AsyncResult, Atom, AtomRegistry } from 'effect/reactivity'
import { useContext, useEffect, useRef, useMemo } from 'react'

import { threadMetaAtom } from './chrome'
import { connectionAtom, subscribe, useAction } from './connection'
import { foldHistoryEvent, mergeHistory } from './history_merge'
import { createItemSelection, noteItemDelta, sameItems } from './item_selection'
import { awaitCreation } from './mutations'

const flights = new Map<string, Set<SequencedEvent[]>>()

export function foldUpdate(state: ThreadState, update: ThreadUpdate): ThreadState {
  if (update.type === 'snapshot') return { ...update.snapshot, lastSeq: update.seq }
  if (update.type === 'event') {
    const next = foldHistoryEvent(state, update)
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

export function noteCompleted(itemId: string) {
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
          if (update.type === 'event')
            for (const events of flights.get(threadId) ?? []) events.push(update)
          if (update.type !== 'event') live = true
          else if (live && update.event.type === 'item.completed')
            noteCompleted(update.event.itemId)
        })
      ),
      Stream.map((update) =>
        foldUpdate(get.once(resumeAtom(threadId)) ?? cached ?? emptyThread, update)
      ),
      Stream.tap((state) => Effect.sync(() => get.set(resumeAtom(threadId), state)))
    )
  }).pipe(Atom.setIdleTTL('90 seconds'))
)

export const threadAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => {
    const resume = get(resumeAtom(threadId))
    get(liveAtom(threadId))
    const state = resume
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
  return registry.getNodes().get(resumeAtom(threadId))?.value()
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

const historyRequests = new Map<string, Promise<boolean>>()

function recordFlight(threadId: string) {
  const events: SequencedEvent[] = []
  let active = flights.get(threadId)
  if (!active) {
    active = new Set()
    flights.set(threadId, active)
  }
  active.add(events)
  return {
    events,
    release() {
      active.delete(events)
      if (!active.size) flights.delete(threadId)
    },
  }
}

export function fetchHistory(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  params: { before?: string; target?: string; oldest?: boolean; agentId?: string } = {}
) {
  const key = `${threadId}:${JSON.stringify(params)}`
  const existing = historyRequests.get(key)
  if (existing) return existing
  const flight = recordFlight(threadId)
  const request = Effect.runPromise(
    AtomRegistry.getResult(registry, connectionAtom).pipe(
      Effect.flatMap((connection) => connection.request('thread.history', { threadId, ...params })),
      Effect.tap((page) =>
        Effect.sync(() => {
          const state = registry.get(resumeAtom(threadId))
          if (state) registry.set(resumeAtom(threadId), mergeHistory(state, page, flight.events))
        })
      )
    )
  )
    .then(
      () => true,
      () => false
    )
    .finally(() => {
      flight.release()
      historyRequests.delete(key)
    })
  historyRequests.set(key, request)
  return request
}

function olderHistory(registry: AtomRegistry.AtomRegistry, threadId: string) {
  const state = peekThread(registry, threadId)
  if (!state?.history || !state.history.ranges[0]?.start) return Promise.resolve(false)
  return fetchHistory(registry, threadId, { before: state.items[0]!.id })
}

const gapRequests = new Set<string>()

async function fillHistoryGaps(registry: AtomRegistry.AtomRegistry, threadId: string) {
  if (gapRequests.has(threadId)) return
  gapRequests.add(threadId)
  try {
    for (;;) {
      const state = peekThread(registry, threadId)
      if (!state?.history || state.history.ranges.length < 2) return
      const ranges = state.history.ranges
      const offset = ranges.slice(0, -1).reduce((sum, range) => sum + range.end - range.start, 0)
      if (!(await fetchHistory(registry, threadId, { before: state.items[offset]!.id }))) return
    }
  } finally {
    gapRequests.delete(threadId)
  }
}

async function seekHistory(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  target?: string,
  agentId?: string
) {
  const loaded = peekThread(registry, threadId)
  if (target && loaded?.items.some((item) => item.id === target)) return true
  const ok = await fetchHistory(
    registry,
    threadId,
    agentId ? { agentId } : target ? { target } : { oldest: true }
  )
  if (ok) void fillHistoryGaps(registry, threadId)
  return ok
}

const outputRequests = new Map<string, Set<string>>()
const outputQueues = new Map<string, Set<string>>()

function warmToolOutputs(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  itemIds: readonly string[]
) {
  const state = peekThread(registry, threadId)
  if (!state) return
  const omitted = new Set(
    state.items.flatMap((item) =>
      item.kind === 'tool_call' && item.outputBytes !== undefined ? [item.id] : []
    )
  )
  let queue = outputQueues.get(threadId)
  if (!queue) {
    queue = new Set()
    outputQueues.set(threadId, queue)
    queueMicrotask(() => void flushToolOutputs(registry, threadId))
  }
  for (const id of itemIds)
    if (omitted.has(id) && !outputRequests.get(threadId)?.has(id)) queue.add(id)
}

async function flushToolOutputs(registry: AtomRegistry.AtomRegistry, threadId: string) {
  const queue = outputQueues.get(threadId)
  outputQueues.delete(threadId)
  if (!queue?.size) return
  let active = outputRequests.get(threadId)
  if (!active) {
    active = new Set()
    outputRequests.set(threadId, active)
  }
  const ids = [...queue].filter((id) => !active.has(id))
  for (let start = 0; start < ids.length; start += 64) {
    const batch = ids.slice(start, start + 64)
    for (const id of batch) active.add(id)
    const flight = recordFlight(threadId)
    try {
      const result = await Effect.runPromise(
        AtomRegistry.getResult(registry, connectionAtom).pipe(
          Effect.flatMap((connection) =>
            connection.request('thread.toolOutputs', { threadId, itemIds: batch })
          )
        )
      )
      const state = registry.get(resumeAtom(threadId))
      if (!state) continue
      const outputs = new Map(result.outputs.map((output) => [output.itemId, output.output]))
      let hydrated: ThreadState = {
        ...state,
        lastSeq: result.seq,
        items: state.items.map((item) => {
          const output = outputs.get(item.id)
          if (item.kind !== 'tool_call' || item.outputBytes === undefined || output === undefined)
            return item
          const { outputBytes: _bytes, ...full } = item
          return { ...full, output }
        }),
      }
      for (const event of flight.events)
        if (event.seq > result.seq && 'itemId' in event.event && outputs.has(event.event.itemId))
          hydrated = { ...hydrated, ...foldHistoryEvent(hydrated, event) }
      registry.set(resumeAtom(threadId), { ...state, items: hydrated.items })
    } catch {
      // The next viewport or hover warm retries a dropped request.
    } finally {
      flight.release()
      for (const id of batch) active.delete(id)
    }
  }
  if (!active.size) outputRequests.delete(threadId)
}

export function useHistory(threadId: string) {
  const registry = useContext(RegistryContext)
  return useMemo(
    () => ({
      older: () => olderHistory(registry, threadId),
      seek: (target?: string, agentId?: string) => seekHistory(registry, threadId, target, agentId),
      warm: (ids: readonly string[]) => warmToolOutputs(registry, threadId, ids),
    }),
    [registry, threadId]
  )
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
  return Atom.readable((get) => select(summaryItems(get(threadAtom(threadId))))).pipe(
    Atom.withEquality(sameItems)
  )
})

const todosAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => {
    const state = get(threadAtom(threadId))
    return state?.summary
      ? foldTodos(
          state.summary.items,
          state.summary.latestTurnId ?? undefined,
          state.summary.todoBase
        ).todos
      : foldTodos(state?.items ?? noItems).todos
  }).pipe(Atom.withEquality((a, b) => JSON.stringify(a) === JSON.stringify(b)))
)

export function useOverviewItems(threadId: string) {
  return {
    items: useAtomValue(overviewItemsAtom(threadId)),
    todos: useAtomValue(todosAtom(threadId)),
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

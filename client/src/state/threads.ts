import type { ThreadUpdate } from '@jetty/shared/rpc'

import { perf } from '@/perf'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { backgroundStatus } from '@jetty/shared/wire'
import { Effect, Stream } from 'effect'
import { AsyncResult, Atom, type AtomRegistry } from 'effect/reactivity'
import { useContext, useEffect, useRef } from 'react'

import { chromeAtom } from './chrome'
import { subscribe, useAction } from './connection'
import { awaitCreation } from './mutations'

function foldUpdate(state: ThreadState, update: ThreadUpdate): ThreadState {
  if (update.type === 'snapshot') return { ...update.snapshot, lastSeq: update.seq }
  if (update.type === 'event') return applyEvent(state, update)
  return { ...state, lastSeq: Math.max(state.lastSeq, update.seq) }
}

const resumeAtom = Atom.family((_threadId: string) =>
  Atom.make<ThreadState | undefined>(undefined).pipe(Atom.setIdleTTL('10 minutes'))
)

// `get.once`, not `get`: a parent link would shorten resume's TTL by live's on sweep.
const liveAtom = Atom.family((threadId: string) =>
  Atom.make((get) => {
    const cached = get.once(resumeAtom(threadId))
    return subscribe(get, (connection) =>
      Stream.unwrap(
        Effect.as(awaitCreation(threadId), connection.subscribeThread(threadId, cached?.lastSeq))
      )
    ).pipe(
      Stream.tap((update) => Effect.sync(() => perf.threadUpdate(threadId, update))),
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
    const thread = get(chromeAtom)?.threads.find((thread) => thread.id === threadId)
    if (!state) return state
    const status = backgroundStatus(
      state.status,
      thread?.backgroundTasks ?? [],
      thread?.waitingForChildren
    )
    return status === state.status ? state : { ...state, status }
  })
)

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

import type { ThreadUpdate } from '@jetty/shared/rpc'

import { useAtomValue } from '@effect/atom-react'
import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { Effect, Stream } from 'effect'
import { AsyncResult, Atom } from 'effect/unstable/reactivity'

import { subscribe } from './connection'
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
      Stream.scan(cached ?? emptyThread, foldUpdate),
      Stream.drop(1),
      Stream.tap((state) => Effect.sync(() => get.set(resumeAtom(threadId), state)))
    )
  }).pipe(Atom.setIdleTTL('90 seconds'))
)

export const threadAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => {
    const resume = get(resumeAtom(threadId))
    return AsyncResult.getOrElse(get(liveAtom(threadId)), () => resume)
  })
)

const unread = Atom.readable<ThreadState | undefined>(() => undefined)

export function useThread(threadId: string): ThreadState | undefined {
  return useAtomValue(threadAtom(threadId))
}

export function usePrefetchThread(threadId: string | undefined) {
  return useAtomValue(threadId ? threadAtom(threadId) : unread)
}

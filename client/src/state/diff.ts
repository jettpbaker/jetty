import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { AsyncResult, Atom } from 'effect/unstable/reactivity'
import { useEffect, useRef } from 'react'

import { connectionAtom } from './connection'
import { useThread } from './threads'

const diffAtom = Atom.family((threadId: string) =>
  Atom.make((get) =>
    get
      .result(connectionAtom)
      .pipe(Effect.flatMap((connection) => connection.request('thread.diff', { threadId })))
  ).pipe(Atom.setIdleTTL('10 minutes'))
)

const liveStatuses = new Set(['starting', 'running', 'awaiting_approval'])

// Mount only while the diff is on screen: a cached diff renders at once and is
// refreshed behind it, and every finished turn refreshes it again.
export function useThreadDiff(threadId: string) {
  const atom = diffAtom(threadId)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const live = liveStatuses.has(useThread(threadId)?.status ?? 'idle')
  const cachedOnMount = useRef(!AsyncResult.isInitial(result))
  const wasLive = useRef(live)

  useEffect(() => {
    if (cachedOnMount.current) refresh()
  }, [refresh])

  useEffect(() => {
    if (wasLive.current && !live) refresh()
    wasLive.current = live
  }, [live, refresh])

  return {
    diff: AsyncResult.getOrElse(result, () => undefined),
    failed: AsyncResult.isFailure(result),
  }
}

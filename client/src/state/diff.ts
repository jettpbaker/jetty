import type { DiffScope, ThreadMeta } from '@jetty/shared/wire'

import { RegistryContext, useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { AsyncResult, Atom, AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext, useEffect, useRef } from 'react'

import { useChrome } from './chrome'
import { connectionAtom } from './connection'
import { useThread } from './threads'

const diffAtom = Atom.family((key: string) => {
  const [threadId, scope] = key.split('\0') as [string, DiffScope]
  return Atom.make((get) =>
    get
      .result(connectionAtom)
      .pipe(Effect.flatMap((connection) => connection.request('thread.diff', { threadId, scope })))
  ).pipe(Atom.setIdleTTL('10 minutes'))
})

// A refresh cancels the request before it, and the Overview and Changes refresh together
// (opening the pane, the end of a turn), so refreshes in one task share one request.
const refreshing = new Set<string>()

function refreshDiff(registry: AtomRegistry.AtomRegistry, key: string) {
  if (refreshing.has(key)) return
  refreshing.add(key)
  queueMicrotask(() => refreshing.delete(key))
  registry.refresh(diffAtom(key))
}

const liveStatuses = new Set(['starting', 'running', 'awaiting_approval'])

// Worktree threads show everything since their base commit; local ones only uncommitted edits.
export function defaultDiffScope(thread: ThreadMeta | undefined): DiffScope {
  return thread?.environment === 'worktree' ? 'branch' : 'uncommitted'
}

// Mount only while the diff is on screen: a cached diff renders at once and is
// refreshed behind it, and every finished turn refreshes it again.
export function useThreadDiff(threadId: string, scope?: DiffScope) {
  const meta = useChrome()?.threads.find((thread) => thread.id === threadId)
  const key = `${threadId}\0${scope ?? defaultDiffScope(meta)}`
  const result = useAtomValue(diffAtom(key))
  const registry = useContext(RegistryContext)
  const refresh = useCallback(() => refreshDiff(registry, key), [registry, key])
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

const fetchedAfterTurn = new Map<string, number>()

// Loads a thread's diff into the cache without showing it, again once a later turn has ended.
export function useThreadDiffFetch() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, scope: DiffScope, turnEndedAt: number | undefined) => {
      const key = `${threadId}\0${scope}`
      const atom = diffAtom(key)
      if (turnEndedAt !== undefined && fetchedAfterTurn.get(key) !== turnEndedAt) {
        fetchedAfterTurn.set(key, turnEndedAt)
        refreshDiff(registry, key)
      }
      return Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
    },
    [registry]
  )
}

export function useDiffFileLoader(threadId: string, scope: DiffScope) {
  const registry = useContext(RegistryContext)
  return useCallback(
    (path: string, prevPath?: string) =>
      Effect.runPromise(
        AtomRegistry.getResult(registry, connectionAtom).pipe(
          Effect.flatMap((connection) =>
            connection.request('thread.diffFile', {
              threadId,
              scope,
              path,
              ...(prevPath === undefined ? {} : { prevPath }),
            })
          )
        )
      ),
    [registry, threadId, scope]
  )
}

const projectFileAtom = Atom.family((key: string) => {
  const split = key.indexOf('\0')
  const threadId = key.slice(0, split)
  const path = key.slice(split + 1)
  return Atom.make((get) =>
    get
      .result(connectionAtom)
      .pipe(
        Effect.flatMap((connection) => connection.request('thread.readFile', { threadId, path }))
      )
  ).pipe(Atom.setIdleTTL('10 minutes'))
})

// A reopened file renders from cache at once and is re-read behind it.
export function useProjectFile(threadId: string, path: string) {
  const atom = projectFileAtom(`${threadId}\0${path}`)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const cachedOnMount = useRef(!AsyncResult.isInitial(result))
  useEffect(() => {
    if (cachedOnMount.current) refresh()
  }, [refresh])
  return {
    file: AsyncResult.getOrElse(result, () => undefined),
    failed: AsyncResult.isFailure(result),
  }
}

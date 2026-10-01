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

const liveStatuses = new Set(['starting', 'running', 'awaiting_approval'])

// Worktree threads show everything since their base commit; local ones only uncommitted edits.
export function defaultDiffScope(thread: ThreadMeta | undefined): DiffScope {
  return thread?.environment === 'worktree' ? 'branch' : 'uncommitted'
}

// Mount only while the diff is on screen: a cached diff renders at once and is
// refreshed behind it, and every finished turn refreshes it again.
export function useThreadDiff(threadId: string, scope?: DiffScope) {
  const meta = useChrome()?.threads.find((thread) => thread.id === threadId)
  const atom = diffAtom(`${threadId}\0${scope ?? defaultDiffScope(meta)}`)
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

import type { ThreadItem } from '@jetty/shared/items'
import type { DiffScope, ThreadMeta } from '@jetty/shared/wire'

import { RegistryContext, useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { AsyncResult, Atom, AtomRegistry } from 'effect/reactivity'
import { useCallback, useContext, useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { useChrome } from './chrome'
import { connectionAtom, useAction } from './connection'
import { threadAtom, useThread } from './threads'

const diffAtom = Atom.family((key: string) => {
  const [threadId, scope] = key.split('\0') as [string, DiffScope]
  return Atom.make((get) =>
    get
      .result(connectionAtom)
      .pipe(Effect.flatMap((connection) => connection.request('thread.diff', { threadId, scope })))
  ).pipe(Atom.setIdleTTL('10 minutes'))
})

// A refresh cancels the request before it, and the Overview and Changes refresh together
// (opening the pane, settled tool calls, the end of a turn), so refreshes in one task share one
// request.
const refreshing = new Set<string>()

function refreshDiff(registry: AtomRegistry.AtomRegistry, key: string) {
  if (refreshing.has(key)) return
  refreshing.add(key)
  queueMicrotask(() => refreshing.delete(key))
  registry.refresh(diffAtom(key))
}

const liveStatuses = new Set(['starting', 'running', 'awaiting_approval'])

function finishedToolCalls(items: readonly ThreadItem[]) {
  let count = 0
  for (const item of items) if (item.kind === 'tool_call' && item.status !== 'running') count++
  return count
}

// Any tool call may have changed files (agents edit through a shell as much as through edit
// tools), so once a live thread's tool calls stop finishing for a second, its diff is due a
// refresh. A turn's end refreshes the diff anyway, so it drops one still waiting.
const toolsSettledAtom = Atom.family((threadId: string) =>
  Atom.make((get) => {
    let finished: number | undefined
    let settled = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    get.addFinalizer(() => clearTimeout(timer))
    get.subscribe(
      threadAtom(threadId),
      (state) => {
        if (!state) return
        const count = finishedToolCalls(state.items)
        if (!liveStatuses.has(state.status)) clearTimeout(timer)
        else if (finished !== undefined && count !== finished) {
          clearTimeout(timer)
          timer = setTimeout(() => get.setSelf(++settled), 1000)
        }
        finished = count
      },
      { immediate: true }
    )
    return settled
  })
)

// Calls back each time the thread's tool calls settle, without rendering.
export function useToolsSettled(threadId: string, onSettled: () => void) {
  const registry = useContext(RegistryContext)
  useEffect(() => {
    const atom = toolsSettledAtom(threadId)
    // Subscribing alone doesn't build an atom.
    registry.get(atom)
    return registry.subscribe(atom, onSettled)
  }, [registry, threadId, onSettled])
}

// Worktree threads show everything since their base commit; local ones only uncommitted edits.
export function defaultDiffScope(thread: ThreadMeta | undefined): DiffScope {
  return thread?.environment === 'worktree' ? 'branch' : 'uncommitted'
}

// Mount only while the diff is on screen: a cached diff renders at once and is
// refreshed behind it, and settled tool calls and every finished turn refresh it again.
export function useThreadDiff(threadId: string, scope?: DiffScope) {
  const meta = useChrome()?.threads.find((thread) => thread.id === threadId)
  const key = `${threadId}\0${scope ?? defaultDiffScope(meta)}`
  const result = useAtomValue(diffAtom(key))
  const registry = useContext(RegistryContext)
  const refresh = useCallback(() => refreshDiff(registry, key), [registry, key])
  const live = liveStatuses.has(useThread(threadId)?.status ?? 'idle')
  const cachedOnMount = useRef(!AsyncResult.isInitial(result))
  const wasLive = useRef(live)
  useToolsSettled(threadId, refresh)

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

// Loads a thread's diff into the cache without showing it, again once a later turn has ended
// or when `fresh`.
export function useThreadDiffFetch() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, scope: DiffScope, turnEndedAt: number | undefined, fresh = false) => {
      const key = `${threadId}\0${scope}`
      const atom = diffAtom(key)
      const turnEnded = turnEndedAt !== undefined && fetchedAfterTurn.get(key) !== turnEndedAt
      if (turnEnded) fetchedAfterTurn.set(key, turnEndedAt)
      if (turnEnded || fresh) refreshDiff(registry, key)
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

// A reopened file renders from cache at once and is re-read behind it. An open file follows
// edits on disk: it's re-read when the thread's tool calls settle, when a turn ends and when the
// window regains focus.
export function useProjectFile(threadId: string, path: string) {
  const atom = projectFileAtom(`${threadId}\0${path}`)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const cachedOnMount = useRef(!AsyncResult.isInitial(result))
  const turnEndedAt = useChrome()?.threads.find((thread) => thread.id === threadId)?.turnEndedAt
  const turnEnded = useRef(turnEndedAt)
  useToolsSettled(threadId, refresh)
  useEffect(() => {
    if (cachedOnMount.current) refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])
  useEffect(() => {
    if (turnEnded.current === turnEndedAt) return
    turnEnded.current = turnEndedAt
    refresh()
  }, [turnEndedAt, refresh])
  return {
    file: AsyncResult.getOrElse(result, () => undefined),
    failed: AsyncResult.isFailure(result),
  }
}

// Saves only while the file on disk still holds `base`; a save refreshes the cached file and the
// thread's diffs behind it. A failed save says why and resolves to undefined.
function saveProjectFile(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  path: string,
  contents: string,
  base: string | null
) {
  return Effect.runPromise(
    AtomRegistry.getResult(registry, connectionAtom).pipe(
      Effect.flatMap((connection) =>
        connection.request('thread.writeFile', { threadId, path, contents, base })
      ),
      Effect.tap((result) =>
        Effect.sync(() => {
          if (!('saved' in result)) return
          registry.refresh(projectFileAtom(`${threadId}\0${path}`))
          for (const scope of ['branch', 'uncommitted'] as const)
            refreshDiff(registry, `${threadId}\0${scope}`)
        })
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          toast.error(`Couldn't save ${path.split('/').at(-1)}`, { description: error.message })
          return undefined
        })
      )
    )
  )
}

export const useSaveProjectFile = () => useAction(saveProjectFile)

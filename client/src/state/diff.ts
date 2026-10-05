import type { ThreadItem } from '@jetty/shared/items'
import type { DiffScope, ThreadMeta } from '@jetty/shared/wire'

import { RegistryContext, useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { Cause, Effect } from 'effect'
import { AsyncResult, Atom, AtomRegistry } from 'effect/reactivity'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useThreadMeta } from './chrome'
import { connectionAtom, useAction } from './connection'
import { beginFileSave, endFileSave, settleFileDraft } from './file_drafts'
import { threadAtom, threadStatusAtom } from './threads'

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

// Coming back to the window re-reads what's on screen, but at most once every 30s, so
// alt-tabbing back and forth doesn't re-read the open file and every open folder each time.
const focusRefreshMs = 30_000

export function useRefreshOnFocus(refresh: () => void) {
  useEffect(() => {
    let last = performance.now()
    function focused() {
      const now = performance.now()
      if (now - last < focusRefreshMs) return
      last = now
      refresh()
    }
    window.addEventListener('focus', focused)
    return () => window.removeEventListener('focus', focused)
  }, [refresh])
}

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

// When each atom was last read on a mount. The details pane mounts its Changes a frame after its
// Overview, and both show the same diff.
const mountReads = new WeakMap<object, number>()

// A value cached from an earlier visit renders at once and is re-read behind it, once for
// everything that mounts with it. Checked per atom, so switching to another key that was cached
// earlier re-reads it too.
function useRefreshCached(
  atom: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>,
  refresh: () => void
) {
  const registry = useContext(RegistryContext)
  useEffect(() => {
    const now = performance.now()
    if (now - (mountReads.get(atom) ?? -Infinity) < 1000) return
    mountReads.set(atom, now)
    if (!AsyncResult.isInitial(registry.get(atom))) refresh()
  }, [atom, refresh, registry])
}

// Worktree threads show everything since their base commit; local ones only uncommitted edits.
export function defaultDiffScope(thread: ThreadMeta | undefined): DiffScope {
  return thread?.environment === 'worktree' ? 'branch' : 'uncommitted'
}

// Mount only while the diff is on screen: a cached diff renders at once and is
// refreshed behind it, and settled tool calls and every finished turn refresh it again.
export function useThreadDiff(threadId: string, scope?: DiffScope) {
  const meta = useThreadMeta(threadId)
  const key = `${threadId}\0${scope ?? defaultDiffScope(meta)}`
  const atom = diffAtom(key)
  const result = useAtomValue(atom)
  const registry = useContext(RegistryContext)
  const refresh = useCallback(() => refreshDiff(registry, key), [registry, key])
  const live = liveStatuses.has(useAtomValue(threadStatusAtom(threadId)) ?? 'idle')
  const wasLive = useRef(live)
  useToolsSettled(threadId, refresh)
  useRefreshCached(atom, refresh)

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
// window regains focus (at most every 30s).
export function useProjectFile(threadId: string, path: string) {
  const atom = projectFileAtom(`${threadId}\0${path}`)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const turnEndedAt = useThreadMeta(threadId)?.turnEndedAt
  const turnEnded = useRef(turnEndedAt)
  useToolsSettled(threadId, refresh)
  useRefreshCached(atom, refresh)
  useRefreshOnFocus(refresh)
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

// Lists one folder of the thread's working folder ('' is its top).
export function useFolderReader(threadId: string) {
  const registry = useContext(RegistryContext)
  return useCallback(
    (path: string) =>
      Effect.runPromise(
        AtomRegistry.getResult(registry, connectionAtom).pipe(
          Effect.flatMap((connection) =>
            connection.request('thread.readDirectory', { threadId, path })
          ),
          Effect.map(({ entries }) => entries)
        )
      ),
    [registry, threadId]
  )
}

const fileSearchAtom = Atom.family((key: string) => {
  const [projectId = '', threadId = '', query = ''] = key.split('\0')
  const params = { projectId, threadId, query, limit: 50 }
  return Atom.make((get) =>
    get
      .result(connectionAtom)
      .pipe(Effect.flatMap((connection) => connection.request('fs.search', params)))
  ).pipe(Atom.setIdleTTL('1 minute'))
})

// The files git doesn't ignore in the thread's working folder that fuzzy-match the query, best
// first. The last list stays while the next one loads, so typing never blanks it; `fresh` says
// it's this query's.
export function useFileSearch(projectId: string, threadId: string, query: string) {
  const result = useAtomValue(fileSearchAtom(`${projectId}\0${threadId}\0${query}`))
  const [shown, setShown] = useState<readonly string[]>()
  const fresh = AsyncResult.isSuccess(result) ? result.value.files : undefined
  if (fresh && fresh !== shown) setShown(fresh)
  return { files: fresh ?? shown, fresh: fresh !== undefined }
}

// Saves the file's draft text only while the file on disk still holds `base`; a save settles the
// draft and refreshes the cached file and the thread's diffs behind it. A failed save says why and
// resolves to undefined.
function saveProjectFile(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  path: string,
  contents: string,
  base: string | null
) {
  beginFileSave(threadId, path)
  return Effect.runPromise(
    AtomRegistry.getResult(registry, connectionAtom).pipe(
      Effect.flatMap((connection) =>
        connection.request('thread.writeFile', { threadId, path, contents, base })
      ),
      Effect.tap((result) =>
        Effect.sync(() => {
          if (!('saved' in result)) return
          settleFileDraft(registry, threadId, path, contents)
          registry.refresh(projectFileAtom(`${threadId}\0${path}`))
          for (const scope of ['branch', 'uncommitted'] as const)
            refreshDiff(registry, `${threadId}\0${scope}`)
        })
      ),
      Effect.ensuring(Effect.sync(() => endFileSave(registry, threadId, path))),
      // Defects too (a server that doesn't know thread.writeFile yet), or the save fails silently.
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const error = Cause.squash(cause)
          toast.error(`Couldn't save ${path.split('/').at(-1)}`, {
            description: error instanceof Error ? error.message : String(error),
          })
          return undefined
        })
      )
    )
  )
}

export const useSaveProjectFile = () => useAction(saveProjectFile)

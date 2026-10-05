import { storage } from '@/platform'
import { useAtomValue } from '@effect/atom-react'
import { methods, type ResultOf } from '@jetty/shared/wire'
import { Effect, Schema } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { run, useAction } from './connection'

type Branches = ResultOf<'project.branches'>
export type BranchList = Branches | { git: 'error'; message: string }

// Each project's last good answers survive reloads, so pickers show its branches straight away
// while this session's answers (the full list waits on a fetch from origin) catch up.
const cacheKey = 'jetty.branch-lists'
const isBranches = Schema.is(methods['project.branches'].result)

function loadCached() {
  const lists = new Map<string, Branches>()
  try {
    const saved: unknown = JSON.parse(storage.get(cacheKey) ?? '{}')
    if (saved && typeof saved === 'object')
      for (const [key, list] of Object.entries(saved)) if (isBranches(list)) lists.set(key, list)
  } catch {}
  return lists
}

const cachedLists = loadCached()
const branchListsAtom = Atom.make(new Map<string, BranchList>()).pipe(Atom.keepAlive)
const listKey = (projectId: string, localOnly: boolean) =>
  `${projectId}:${localOnly ? 'local' : 'all'}`

// Lists load passively (mount, hover), so a failure never toasts; it only shows when there's no
// good list to keep.
function branches(registry: AtomRegistry.AtomRegistry, projectId: string, localOnly: boolean) {
  const key = listKey(projectId, localOnly)
  const known = () => registry.get(branchListsAtom).get(key) ?? cachedLists.get(key)
  function store(list: BranchList) {
    const lists = new Map(registry.get(branchListsAtom)).set(key, list)
    registry.set(branchListsAtom, lists)
    const latest = new Map<string, BranchList>([...cachedLists, ...lists])
    const good = [...latest].filter(([, entry]) => entry.git === 'ok')
    storage.set(cacheKey, JSON.stringify(Object.fromEntries(good)))
  }
  run(registry, (connection) =>
    connection.request('project.branches', { projectId, localOnly }).pipe(
      Effect.tap((result) => Effect.sync(() => store(result))),
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (known()?.git !== 'ok') store({ git: 'error', message: error.message })
        })
      )
    )
  )
}
export const useBranches = () => useAction(branches)

export function useBranchList(projectId: string | undefined, localOnly: boolean) {
  const lists = useAtomValue(branchListsAtom)
  if (projectId === undefined) return undefined
  const key = listKey(projectId, localOnly)
  return lists.get(key) ?? cachedLists.get(key)
}

// Either list knows the project's git state; if neither has landed this session, load the cheap
// local one, answering from the cache meanwhile.
export function useProjectGit(projectId: string | undefined) {
  const lists = useAtomValue(branchListsAtom)
  const fetchBranches = useBranches()
  const keys = projectId === undefined ? [] : [listKey(projectId, false), listKey(projectId, true)]
  const fresh = keys.map((key) => lists.get(key)).find(Boolean)
  useEffect(() => {
    if (projectId && !fresh) fetchBranches(projectId, true)
  }, [projectId, fresh, fetchBranches])
  return fresh ?? keys.map((key) => cachedLists.get(key)).find(Boolean)
}

function setPrefix(registry: AtomRegistry.AtomRegistry, prefix: string, done: () => void) {
  run(registry, (connection) =>
    connection.request('settings.setBranchPrefix', { prefix }).pipe(
      Effect.tap(() => Effect.sync(done)),
      Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))
    )
  )
}
export const useSetBranchPrefix = () => useAction(setPrefix)

function retry(registry: AtomRegistry.AtomRegistry, threadId: string) {
  run(registry, (connection) => connection.request('thread.retrySetup', { threadId }))
}
export const useRetrySetup = () => useAction(retry)

function changes(
  registry: AtomRegistry.AtomRegistry,
  threadId: string,
  done: (count: number) => void
) {
  run(registry, (connection) =>
    connection.request('thread.worktreeChanges', { threadId }).pipe(
      Effect.tap(({ count }) => Effect.sync(() => done(count))),
      Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))
    )
  )
}
export const useWorktreeChanges = () => useAction(changes)

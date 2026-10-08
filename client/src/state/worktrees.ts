import { storage } from '@/platform'
import { useAtomValue } from '@effect/atom-react'
import { methods, type ResultOf, type ThreadMeta } from '@jetty/shared/wire'
import { Effect, Schema } from 'effect'
import { AsyncResult, Atom, type AtomRegistry } from 'effect/reactivity'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { liveAtom } from './chrome'
import { run, useAction } from './connection'
import { observeOptimistic } from './optimistic'

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

// Either list knows a project's git state; if neither has landed this session, load the cheap
// local one, answering from the cache meanwhile.
export function useProjectsGit(projectIds: readonly string[]) {
  const lists = useAtomValue(branchListsAtom)
  const fetchBranches = useBranches()
  const known = (map: ReadonlyMap<string, BranchList>, id: string) =>
    map.get(listKey(id, false)) ?? map.get(listKey(id, true))
  const missing = projectIds.filter((id) => !known(lists, id)).join('\n')
  useEffect(() => {
    for (const id of missing.split('\n')) if (id) fetchBranches(id, true)
  }, [missing, fetchBranches])
  return projectIds.map((id) => known(lists, id) ?? known(cachedLists, id))
}

export function useProjectGit(projectId: string | undefined) {
  return useProjectsGit(projectId === undefined ? [] : [projectId])[0]
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

function setDefaultEnvironment(
  registry: AtomRegistry.AtomRegistry,
  environment: ThreadMeta['environment'],
  settled: () => void
) {
  const pending = observeOptimistic(
    registry,
    liveAtom,
    (state) => AsyncResult.getOrElse(state, () => undefined)?.defaultEnvironment === environment,
    settled
  )
  run(
    registry,
    (connection) =>
      connection
        .request('settings.setDefaultEnvironment', { environment })
        .pipe(Effect.tap(() => Effect.sync(pending.accepted))),
    pending.failed
  )
}
export const useSetDefaultEnvironment = () => useAction(setDefaultEnvironment)

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

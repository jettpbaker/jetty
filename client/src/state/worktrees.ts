import type { ResultOf } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'
import { toast } from 'sonner'

import { run, useAction } from './connection'

type Branches = ResultOf<'project.branches'>
export type BranchList = Branches | { git: 'error'; message: string }

const branchListsAtom = Atom.make(new Map<string, BranchList>()).pipe(Atom.keepAlive)
const listKey = (projectId: string, localOnly: boolean) =>
  `${projectId}:${localOnly ? 'local' : 'all'}`

// Answers from the cached list first, then again once the fresh one lands. Lists load passively
// (mount, hover), so a failure never toasts; it only shows when there's no good list to keep.
function branches(
  registry: AtomRegistry.AtomRegistry,
  projectId: string,
  localOnly: boolean,
  done?: (result: Branches) => void
) {
  const key = listKey(projectId, localOnly)
  const cached = registry.get(branchListsAtom).get(key)
  if (cached && cached.git !== 'error') done?.(cached)
  function store(list: BranchList) {
    registry.update(branchListsAtom, (lists) => new Map(lists).set(key, list))
  }
  run(registry, (connection) =>
    connection.request('project.branches', { projectId, localOnly }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          store(result)
          done?.(result)
        })
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (registry.get(branchListsAtom).get(key)?.git !== 'ok')
            store({ git: 'error', message: error.message })
        })
      )
    )
  )
}
export const useBranches = () => useAction(branches)

export function useBranchList(projectId: string | undefined, localOnly: boolean) {
  const lists = useAtomValue(branchListsAtom)
  return projectId === undefined ? undefined : lists.get(listKey(projectId, localOnly))
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

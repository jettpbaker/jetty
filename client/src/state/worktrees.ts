import type { ResultOf } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { type AtomRegistry } from 'effect/unstable/reactivity'
import { toast } from 'sonner'

import { run, useAction } from './connection'

function branches(
  registry: AtomRegistry.AtomRegistry,
  projectId: string,
  query: string,
  localOnly: boolean,
  done: (result: ResultOf<'project.branches'>) => void
) {
  return run(registry, (connection) =>
    connection.request('project.branches', { projectId, query, localOnly }).pipe(
      Effect.tap((result) => Effect.sync(() => done(result))),
      Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))
    )
  )
}
export const useBranches = () => useAction(branches)

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

import { isBoolean, useStoredState } from '@/lib/stored-state'
import { useChrome } from '@/state'
import { useBranches, useBranchList, type BranchList } from '@/state/worktrees'
import { useEffect, useEffectEvent } from 'react'

import { ComposerBranch, settleRef, switchRef } from './composer_branch'
import { ComposerEnvironment } from './composer_environment'

export function ComposerFooter({
  projectId,
  environment,
  onEnvironmentChange,
  startingRef,
  onStartingRefChange,
}: {
  environment: 'local' | 'worktree'
  onEnvironmentChange: (environment: 'local' | 'worktree') => void
  startingRef?: string
  onStartingRefChange: (ref: string) => void
  projectId?: string
}) {
  const chrome = useChrome()
  const fetchBranches = useBranches()
  const localOnly = environment === 'local'
  const branchList = useBranchList(projectId, localOnly)
  // Either mode knows the git state and checkout branch, so the other's list fills in until this
  // one lands.
  const otherList = useBranchList(projectId, !localOnly)
  const known = branchList ?? otherList
  const list = branchList?.git === 'ok' ? branchList : undefined
  const [fromOrigin, setFromOrigin] = useStoredState(
    'jetty.composer.startFromOrigin',
    true,
    isBoolean
  )
  const settle = useEffectEvent((result: Extract<BranchList, { git: 'ok' }>) => {
    const ref = settleRef(result, startingRef, fromOrigin)
    if (ref !== startingRef) onStartingRefChange(ref)
  })
  useEffect(() => {
    if (projectId) fetchBranches(projectId, localOnly)
  }, [projectId, localOnly, fetchBranches])
  // Every list that lands checks the pick, so a branch deleted since stops being the base.
  useEffect(() => {
    if (list && !localOnly) settle(list)
  }, [list, localOnly])

  const project = chrome?.projects.find((entry) => entry.id === projectId)
  const noGit =
    known?.git === 'missing'
      ? 'Project folder not found'
      : known?.git === 'not-git'
        ? `${project?.title ?? 'This project'} isn't a git repository`
        : undefined
  const branchProblem = noGit ?? (branchList?.git === 'error' ? branchList.message : undefined)
  const checkout = known?.git === 'ok' ? known.currentBranch || 'Detached HEAD' : undefined
  const branchLabel =
    known?.git === 'missing'
      ? 'Folder missing'
      : known?.git === 'not-git'
        ? 'Not a git repo'
        : branchProblem
          ? undefined
          : localOnly
            ? checkout
            : startingRef

  return (
    <div
      className='relative z-10 flex flex-wrap items-center justify-between gap-1 px-2.5 opacity-100'
      aria-label='Environment and branch'
    >
      <ComposerEnvironment
        value={environment}
        onValueChange={onEnvironmentChange}
        worktreeDisabled={noGit}
      />
      <ComposerBranch
        branch={branchLabel}
        list={list}
        fromOrigin={fromOrigin}
        onFromOriginChange={(next) => {
          setFromOrigin(next)
          if (list) onStartingRefChange(switchRef(list, startingRef ?? list.defaultRef, next))
        }}
        disabledReason={branchProblem}
        onChange={localOnly ? undefined : onStartingRefChange}
        onOpen={() => {
          if (projectId) fetchBranches(projectId, localOnly)
        }}
      />
    </div>
  )
}

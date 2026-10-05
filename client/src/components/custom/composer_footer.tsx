import { useChrome } from '@/state'
import { useBranches, useBranchList, type BranchList } from '@/state/worktrees'
import { useEffect, useEffectEvent, useRef } from 'react'

import { ComposerBranch } from './composer_branch'
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
  const request = useRef(0)
  const localOnly = environment === 'local'
  const branchList = useBranchList(projectId, localOnly)
  // Either mode knows the git state and checkout branch, so the other's list fills in until this
  // one lands.
  const otherList = useBranchList(projectId, !localOnly)
  const known = branchList ?? otherList
  // A starting ref the list still has stays picked; otherwise the project's default takes over.
  const settleRef = useEffectEvent((result: Extract<BranchList, { git: 'ok' }>) => {
    if (!startingRef || !result.branches.includes(startingRef))
      onStartingRefChange(result.defaultRef)
  })
  useEffect(() => {
    if (!projectId) return
    // Only the newest request may settle; a stale one would apply the wrong project.
    const revision = ++request.current
    fetchBranches(projectId, localOnly, (result) => {
      if (revision === request.current && result.git === 'ok' && !localOnly) settleRef(result)
    })
  }, [projectId, localOnly, fetchBranches])

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
        refs={branchList?.git === 'ok' ? branchList.branches : undefined}
        disabledReason={branchProblem}
        onChange={localOnly ? undefined : onStartingRefChange}
        onOpen={() => {
          if (projectId) fetchBranches(projectId, localOnly)
        }}
      />
    </div>
  )
}

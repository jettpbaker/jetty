import { PlusSignIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { useChrome, useCreateProject } from '@/state'
import { useBranches, useBranchList } from '@/state/worktrees'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { ComposerBranch } from './composer_branch'
import { ComposerEnvironment } from './composer_environment'
import { ComposerProject } from './composer_project'
import { ProjectFolderDialog } from './project_folder_dialog'
import { ProjectGlyph } from './project_glyph'

export function ComposerFooter({
  projectId,
  onProjectChange,
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
  onProjectChange: (projectId: string) => void
}) {
  const chrome = useChrome()
  const createProject = useCreateProject()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const projects = chrome?.projects ?? []
  const fetchBranches = useBranches()
  const request = useRef(0)
  const localOnly = environment === 'local'
  const branchList = useBranchList(projectId, localOnly)
  // Either mode knows the git state and checkout branch, so the other's list fills in until this
  // one lands.
  const otherList = useBranchList(projectId, !localOnly)
  const known = branchList ?? otherList
  // Worktree is the default; only a project without git forces Local, and only until the next one.
  const forcedLocal = useRef(false)
  useEffect(() => {
    if (!projectId) return
    // Only the newest request may settle; a stale one would apply the wrong project.
    const revision = ++request.current
    fetchBranches(projectId, localOnly, (result) => {
      if (revision !== request.current) return
      if (result.git !== 'ok') {
        forcedLocal.current ||= !localOnly
        onEnvironmentChange('local')
      } else if (forcedLocal.current) {
        forcedLocal.current = false
        onEnvironmentChange('worktree')
      } else if (!localOnly) onStartingRefChange(result.defaultRef)
    })
  }, [projectId, localOnly, fetchBranches, onEnvironmentChange, onStartingRefChange])

  const project = projects.find((entry) => entry.id === projectId)
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
      aria-label='Project and branch'
    >
      <div className='flex min-w-0 items-center'>
        {projects.length === 0 ? (
          <Button variant='ghost-text' size='sm' onClick={() => setAdding(true)}>
            <PlusSignIcon />
            Add project
          </Button>
        ) : (
          <ComposerProject
            value={projectId ?? ''}
            options={projects.map((entry) => ({
              value: entry.id,
              label: entry.title,
              icon: <ProjectGlyph icon={entry.icon} data-icon='inline-start' className='size-3' />,
            }))}
            onValueChange={onProjectChange}
            onNewProject={() => setAdding(true)}
            onManageProjects={() => void navigate({ to: '/settings', hash: 'projects' })}
          />
        )}
        <ComposerEnvironment
          value={environment}
          onValueChange={onEnvironmentChange}
          worktreeDisabled={noGit}
        />
      </div>
      <ComposerBranch
        branch={branchLabel}
        refs={branchList?.git === 'ok' ? branchList.branches : undefined}
        disabledReason={branchProblem}
        onChange={localOnly ? undefined : onStartingRefChange}
        onOpen={() => {
          if (projectId) fetchBranches(projectId, localOnly)
        }}
      />
      <ProjectFolderDialog
        open={adding}
        onOpenChange={setAdding}
        existingPaths={projects.map((entry) => entry.path)}
        onAdd={(path) => createProject(path, (created) => onProjectChange(created.id))}
      />
    </div>
  )
}

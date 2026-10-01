import { Button } from '@/components/ui/button'
import { useChrome, useCreateProject } from '@/state'
import { useBranches } from '@/state/worktrees'
import { PlusIcon } from '@primer/octicons-react'
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
  const [branchList, setBranchList] = useState<{
    defaultRef: string
    currentBranch: string
    branches: readonly string[]
  }>()
  function search(query: string) {
    if (!projectId) return
    const revision = ++request.current
    fetchBranches(projectId, query, environment === 'local', (result) => {
      if (revision === request.current) setBranchList(result)
    })
  }
  useEffect(() => {
    setBranchList(undefined)
    if (!projectId) return
    const revision = ++request.current
    fetchBranches(projectId, '', environment === 'local', (result) => {
      if (revision !== request.current) return
      setBranchList(result)
      onStartingRefChange(result.defaultRef)
    })
  }, [projectId, environment, fetchBranches, onStartingRefChange])

  return (
    <div
      className='relative z-10 flex flex-wrap items-center justify-between gap-1 px-2.5 opacity-100'
      aria-label='Project and branch'
    >
      {projects.length === 0 ? (
        <Button variant='ghost-text' size='sm' onClick={() => setAdding(true)}>
          <PlusIcon />
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
      <div className='flex items-center'>
        <ComposerEnvironment value={environment} onValueChange={onEnvironmentChange} />
        <ComposerBranch
          branch={environment === 'worktree' ? startingRef : branchList?.currentBranch}
          refs={branchList?.branches}
          onChange={environment === 'worktree' ? onStartingRefChange : undefined}
          onSearch={search}
        />
      </div>
      <ProjectFolderDialog
        open={adding}
        onOpenChange={setAdding}
        existingPaths={projects.map((entry) => entry.path)}
        onAdd={(path) => createProject(path, (created) => onProjectChange(created.id))}
      />
    </div>
  )
}

import { Button } from '@/components/ui/button'
import { useChrome, useCreateProject } from '@/state'
import { PlusIcon } from '@primer/octicons-react'
import { useState } from 'react'

import { ComposerBranch } from './composer_branch'
import { ComposerProject } from './composer_project'
import { ProjectFolderDialog } from './project_folder_dialog'

export function ComposerFooter({
  projectId,
  onProjectChange,
}: {
  projectId?: string
  onProjectChange: (projectId: string) => void
}) {
  const chrome = useChrome()
  const createProject = useCreateProject()
  const [adding, setAdding] = useState(false)
  const projects = chrome?.projects ?? []
  const threads = chrome?.threads ?? []
  const branch = threads
    .filter((candidate) => candidate.projectId === projectId && candidate.git)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)[0]?.git?.branch

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
          options={projects.map((entry) => ({ value: entry.id, label: entry.title }))}
          onValueChange={onProjectChange}
          onNewProject={() => setAdding(true)}
        />
      )}
      <ComposerBranch branch={branch} />
      <ProjectFolderDialog
        open={adding}
        onOpenChange={setAdding}
        existingPaths={projects.map((entry) => entry.path)}
        onAdd={(path) => createProject(path, (created) => onProjectChange(created.id))}
      />
    </div>
  )
}

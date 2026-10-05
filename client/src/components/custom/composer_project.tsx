import { FolderGit2Icon, Settings01Icon, PlusSignIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { useChrome, useCreateProject } from '@/state'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { OptionPicker } from './option_picker'
import { ProjectFolderDialog } from './project_folder_dialog'
import { ProjectGlyph } from './project_glyph'

export function ComposerProject({
  projectId,
  onProjectChange,
  onSetUpWorktrees,
}: {
  projectId?: string
  onProjectChange: (projectId: string) => void
  // Offered while the project has no worktree config.
  onSetUpWorktrees?: () => void
}) {
  const chrome = useChrome()
  const createProject = useCreateProject()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const projects = chrome?.projects ?? []

  return (
    <div className='relative z-10 flex items-center px-2.5' aria-label='Project'>
      {chrome && projects.length === 0 ? (
        <Button
          variant='ghost-text'
          size='sm'
          className='gap-1.5 rounded-sm'
          onClick={() => setAdding(true)}
        >
          <PlusSignIcon />
          Add project
        </Button>
      ) : (
        <OptionPicker
          name='Project'
          label='Choose project'
          placeholder='Search projects'
          actions={[
            {
              label: 'Manage projects',
              icon: <Settings01Icon />,
              onSelect: () => void navigate({ to: '/settings', hash: 'projects' }),
            },
            { label: 'New project', icon: <PlusSignIcon />, onSelect: () => setAdding(true) },
          ]}
          icon={<ProjectGlyph data-icon='inline-start' className='size-3' />}
          value={projectId ?? ''}
          options={projects.map((entry) => ({
            value: entry.id,
            label: entry.title,
            icon: <ProjectGlyph icon={entry.icon} data-icon='inline-start' className='size-3' />,
          }))}
          onValueChange={onProjectChange}
        />
      )}
      {onSetUpWorktrees && (
        <Button
          variant='ghost-text'
          size='sm'
          className='gap-1.5 rounded-sm'
          // Keeps focus in the composer the prompt was just written into.
          onMouseDown={(event) => event.preventDefault()}
          {...pressProps(onSetUpWorktrees)}
        >
          <FolderGit2Icon />
          Set up worktrees
        </Button>
      )}
      <ProjectFolderDialog
        open={adding}
        onOpenChange={setAdding}
        existingPaths={projects.map((entry) => entry.path)}
        onAdd={(path) => createProject(path, (created) => onProjectChange(created.id))}
      />
    </div>
  )
}

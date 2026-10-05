import { Settings01Icon, PlusSignIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { useChrome, useCreateProject } from '@/state'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { OptionPicker } from './option_picker'
import { ProjectFolderDialog } from './project_folder_dialog'
import { ProjectGlyph } from './project_glyph'

export function ComposerProject({
  projectId,
  onProjectChange,
}: {
  projectId?: string
  onProjectChange: (projectId: string) => void
}) {
  const chrome = useChrome()
  const createProject = useCreateProject()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const projects = chrome?.projects ?? []

  return (
    <div className='relative z-10 flex items-center px-2.5 opacity-100' aria-label='Project'>
      {projects.length === 0 ? (
        <Button variant='ghost-text' size='sm' onClick={() => setAdding(true)}>
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
      <ProjectFolderDialog
        open={adding}
        onOpenChange={setAdding}
        existingPaths={projects.map((entry) => entry.path)}
        onAdd={(path) => createProject(path, (created) => onProjectChange(created.id))}
      />
    </div>
  )
}

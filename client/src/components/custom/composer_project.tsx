import { SettingsGear1Icon, PlusMediumIcon } from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import { useCreateProject, useProjects } from '@/state'
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
  const loaded = useProjects()
  const createProject = useCreateProject()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const projects = loaded ?? []

  return (
    <div className='flex min-w-0 items-center' aria-label='Project'>
      {loaded && projects.length === 0 ? (
        <Button
          variant='ghost-text'
          size='sm'
          className='gap-1.5 rounded-sm'
          onClick={() => setAdding(true)}
        >
          <PlusMediumIcon />
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
              icon: <SettingsGear1Icon />,
              onSelect: () =>
                void navigate({ to: '/settings/$page', params: { page: 'projects' } }),
            },
            { label: 'New project', icon: <PlusMediumIcon />, onSelect: () => setAdding(true) },
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

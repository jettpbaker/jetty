import { GearIcon, PlusIcon, RepoIcon } from '@primer/octicons-react'

import { OptionPicker, type PickerOption } from './option_picker'

export function ComposerProject({
  onNewProject,
  onManageProjects,
  ...props
}: {
  onNewProject: () => void
  onManageProjects: () => void
  value: string
  options: readonly PickerOption[]
  onValueChange: (value: string) => void
}) {
  return (
    <OptionPicker
      name='Project'
      label='Choose project'
      placeholder='Search projects'
      actions={[
        { label: 'Manage projects', icon: <GearIcon />, onSelect: onManageProjects },
        { label: 'New project', icon: <PlusIcon />, onSelect: onNewProject },
      ]}
      icon={<RepoIcon data-icon='inline-start' className='icon-optical-down' />}
      {...props}
    />
  )
}

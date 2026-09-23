import { PencilIcon, PlusIcon, RepoIcon } from '@primer/octicons-react'

import { OptionPicker, type PickerOption } from './option_picker'

export function ComposerProject({
  onNewProject,
  ...props
}: {
  onNewProject: () => void
  value: string
  options: readonly PickerOption[]
  onValueChange: (value: string) => void
}) {
  return (
    <OptionPicker
      label='Choose project'
      placeholder='Search projects'
      actions={[
        { label: 'Edit project', icon: <PencilIcon /> },
        { label: 'New project', icon: <PlusIcon />, onSelect: onNewProject },
      ]}
      icon={<RepoIcon data-icon='inline-start' className='icon-optical-down' />}
      {...props}
    />
  )
}

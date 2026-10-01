import { Settings01Icon, PlusSignIcon } from '@/components/custom/huge_icons'

import { OptionPicker, type PickerOption } from './option_picker'
import { ProjectGlyph } from './project_glyph'

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
        { label: 'Manage projects', icon: <Settings01Icon />, onSelect: onManageProjects },
        { label: 'New project', icon: <PlusSignIcon />, onSelect: onNewProject },
      ]}
      icon={<ProjectGlyph data-icon='inline-start' className='size-3' />}
      {...props}
    />
  )
}

import { DeviceDesktopIcon, GitBranchIcon } from '@primer/octicons-react'

import { OptionPicker } from './option_picker'

type Environment = 'local' | 'worktree'

export function ComposerEnvironment({
  value,
  onValueChange,
}: {
  value: Environment
  onValueChange: (value: Environment) => void
}) {
  return (
    <OptionPicker
      name='Environment'
      label='Choose environment'
      placeholder='Search environments'
      value={value}
      options={[
        { value: 'worktree', label: 'Worktree', icon: <GitBranchIcon /> },
        { value: 'local', label: 'Local', icon: <DeviceDesktopIcon /> },
      ]}
      icon={<GitBranchIcon />}
      onValueChange={(next) => {
        if (next === 'local' || next === 'worktree') onValueChange(next)
      }}
    />
  )
}

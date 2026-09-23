import { GitBranchIcon } from '@primer/octicons-react'

import { OptionPicker } from './option_picker'

export function ComposerBranch({ branch }: { branch?: string }) {
  return (
    <OptionPicker
      name='Branch'
      label='Choose branch'
      placeholder='Search branches'
      align='end'
      disabled
      emptyLabel='Branch'
      icon={<GitBranchIcon data-icon='inline-start' className='icon-optical-down' />}
      value={branch ?? ''}
      options={branch ? [{ value: branch, label: branch }] : []}
      onValueChange={() => {}}
    />
  )
}

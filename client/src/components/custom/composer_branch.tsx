import { GitBranchIcon } from '@primer/octicons-react'

import { DisabledTooltip } from './disabled_tooltip'
import { OptionPicker } from './option_picker'

export function ComposerBranch({ branch }: { branch?: string }) {
  return (
    <DisabledTooltip reason='Coming soon' wrap='flex'>
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
    </DisabledTooltip>
  )
}

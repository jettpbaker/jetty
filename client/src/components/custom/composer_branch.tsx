import { GitBranchIcon } from '@/components/custom/lucide_icons'
import { Button } from '@/components/ui/button'

import { DisabledTooltip } from './disabled_tooltip'
import { OptionPicker } from './option_picker'

export function ComposerBranch({
  branch,
  refs = [],
  disabledReason,
  onChange,
  onOpen,
}: {
  branch?: string
  refs?: readonly string[]
  disabledReason?: string
  onChange?: (ref: string) => void
  onOpen?: () => void
}) {
  if (!onChange || disabledReason)
    return (
      <DisabledTooltip reason={disabledReason} wrap='flex'>
        <Button variant='ghost-text' size='sm' disabled>
          <GitBranchIcon />
          {branch || 'Branch'}
        </Button>
      </DisabledTooltip>
    )
  return (
    <OptionPicker
      name='From'
      label='Choose base ref'
      placeholder='Search branches'
      align='end'
      tooltip={branch && `From ${branch}`}
      icon={<GitBranchIcon />}
      value={branch ?? ''}
      options={[...new Set(branch ? [...refs, branch] : refs)].map((ref) => ({
        value: ref,
        label: ref,
        pinned: ref === refs[0],
        searchOnly: ref.startsWith('origin/'),
      }))}
      onValueChange={onChange}
      onOpen={onOpen}
    />
  )
}

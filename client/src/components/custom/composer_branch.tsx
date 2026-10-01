import { Button } from '@/components/ui/button'
import { GitBranchIcon } from '@primer/octicons-react'

import { OptionPicker } from './option_picker'

export function ComposerBranch({
  branch,
  refs = [],
  onChange,
  onOpen,
}: {
  branch?: string
  refs?: readonly string[]
  onChange?: (ref: string) => void
  onOpen?: () => void
}) {
  if (!onChange)
    return (
      <Button variant='ghost-text' size='sm' disabled>
        <GitBranchIcon />
        {branch || 'Branch'}
      </Button>
    )
  return (
    <OptionPicker
      name='From'
      label='Choose base ref'
      placeholder='Search branches'
      align='end'
      labelPrefix='From '
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

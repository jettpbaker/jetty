import type { DiffScope } from '@jetty/shared/wire'

import { DiffIcon, GitBranchIcon } from '@/components/custom/lucide_icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ChangesScopePicker({
  value,
  onChange,
}: {
  value: DiffScope
  onChange: (scope: DiffScope) => void
}) {
  const label = value === 'branch' ? 'Branch' : 'Uncommitted'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Diff scope: ${label}`}
        render={<Button variant='ghost-text' size='sm' className='gap-1.5 rounded-sm' />}
      >
        {value === 'branch' ? <GitBranchIcon /> : <DiffIcon />}
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-max min-w-32'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next === 'branch' || next === 'uncommitted') onChange(next)
          }}
        >
          <DropdownMenuRadioItem value='branch'>Branch</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='uncommitted'>Uncommitted</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

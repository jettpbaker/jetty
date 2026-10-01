import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type ChangesScope = 'branch' | 'uncommitted'

export function ChangesScopePicker({
  value,
  onChange,
}: {
  value: ChangesScope
  onChange?: (scope: ChangesScope) => void
}) {
  const label = value === 'branch' ? 'Branch' : 'Uncommitted'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Diff scope: ${label}`}
        render={<Button variant='ghost' tone='muted' size='sm' className='rounded-sm px-1' />}
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-max min-w-32'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next === 'branch' || next === 'uncommitted') onChange?.(next)
          }}
        >
          <DropdownMenuRadioItem value='branch' disabled={!onChange}>
            Branch
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='uncommitted'>Uncommitted</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

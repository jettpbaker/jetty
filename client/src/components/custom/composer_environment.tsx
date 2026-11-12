import { WorktreeIcon, MacbookIcon } from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { DisabledTooltip } from './disabled_tooltip'

type Environment = 'local' | 'worktree'

export const environments = {
  worktree: { label: 'Worktree', Icon: WorktreeIcon },
  local: { label: 'Current checkout', Icon: MacbookIcon },
} as const

export function ComposerEnvironment({
  value,
  onValueChange,
  worktreeDisabled,
}: {
  value: Environment
  onValueChange: (value: Environment) => void
  worktreeDisabled?: string
}) {
  const { label, Icon } = environments[value]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant='ghost-text' size='sm' className='gap-1.5 rounded-sm' />}
        aria-label={`Environment: ${label}`}
      >
        <Icon />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent side='bottom' align='start' className='w-max min-w-32'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next === 'local' || next === 'worktree') onValueChange(next)
          }}
        >
          {Object.entries(environments).map(([id, option]) => {
            const reason = id === 'worktree' ? worktreeDisabled : undefined
            return (
              <DisabledTooltip key={id} reason={reason} side='right'>
                <DropdownMenuRadioItem value={id} disabled={reason !== undefined}>
                  <option.Icon />
                  {option.label}
                </DropdownMenuRadioItem>
              </DisabledTooltip>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

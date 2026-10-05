import { FolderGit2Icon, LaptopIcon } from '@/components/custom/huge_icons'
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
  worktree: { label: 'Worktree', Icon: FolderGit2Icon },
  local: { label: 'Current checkout', Icon: LaptopIcon },
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
          <DisabledTooltip reason={worktreeDisabled} side='right'>
            <DropdownMenuRadioItem value='worktree' disabled={worktreeDisabled !== undefined}>
              <FolderGit2Icon />
              Worktree
            </DropdownMenuRadioItem>
          </DisabledTooltip>
          <DropdownMenuRadioItem value='local'>
            <LaptopIcon />
            Current checkout
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

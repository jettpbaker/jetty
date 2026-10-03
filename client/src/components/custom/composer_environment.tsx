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

export function ComposerEnvironment({
  value,
  onValueChange,
  worktreeDisabled,
}: {
  value: Environment
  onValueChange: (value: Environment) => void
  worktreeDisabled?: string
}) {
  const Icon = value === 'local' ? LaptopIcon : FolderGit2Icon
  const label = value === 'local' ? 'Local' : 'Worktree'

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
              <FolderGit2Icon className='text-muted-foreground' />
              Worktree
            </DropdownMenuRadioItem>
          </DisabledTooltip>
          <DropdownMenuRadioItem value='local'>
            <LaptopIcon className='text-muted-foreground' />
            Local
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

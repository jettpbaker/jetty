import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeviceDesktopIcon, GitBranchIcon } from '@primer/octicons-react'

type Environment = 'local' | 'worktree'

export function ComposerEnvironment({
  value,
  onValueChange,
}: {
  value: Environment
  onValueChange: (value: Environment) => void
}) {
  const Icon = value === 'local' ? DeviceDesktopIcon : GitBranchIcon
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
          <DropdownMenuRadioItem value='worktree'>
            <GitBranchIcon className='text-muted-foreground' />
            Worktree
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='local'>
            <DeviceDesktopIcon className='text-muted-foreground' />
            Local
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

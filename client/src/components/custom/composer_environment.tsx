import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ContainerIcon, DeviceDesktopIcon, TerminalIcon } from '@primer/octicons-react'

type Environment = 'local' | 'container'

type ComposerEnvironmentProps = {
  value?: Environment
  containersConfigured?: boolean
  onValueChange?: (value: Environment) => void
  onSetupContainers?: () => void
}

export function ComposerEnvironment({
  value = 'local',
  containersConfigured = false,
  onValueChange,
  onSetupContainers,
}: ComposerEnvironmentProps) {
  const Icon = value === 'local' ? DeviceDesktopIcon : ContainerIcon
  const label = value === 'local' ? 'Local' : 'Container'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant='ghost' tone='muted' size='sm' className='rounded-sm' />}
        aria-label={`Environment: ${label}`}
      >
        <Icon data-icon='inline-start' />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent side='bottom' align='start' className='w-max min-w-32'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next === 'local' || next === 'container') onValueChange?.(next)
          }}
        >
          <DropdownMenuRadioItem value='local'>
            <DeviceDesktopIcon className='text-muted-foreground' />
            Local
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='container' disabled={!containersConfigured}>
            <ContainerIcon className='text-muted-foreground' />
            Container
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!onSetupContainers} onClick={onSetupContainers}>
            <TerminalIcon className='text-muted-foreground' />
            Set up containers
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

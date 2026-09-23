import type { PermissionMode } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LockIcon, UnlockIcon } from '@primer/octicons-react'

const modes: Record<PermissionMode, { label: string; Icon: typeof LockIcon }> = {
  auto: { label: 'Auto', Icon: LockIcon },
  full_access: { label: 'Full access', Icon: UnlockIcon },
}

function isMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && Object.hasOwn(modes, value)
}

export function ComposerAccessMode({
  value,
  onChange,
}: {
  value: PermissionMode
  onChange: (value: PermissionMode) => void
}) {
  const { label, Icon } = modes[value]
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              aria-label={`Access mode: ${label}`}
              render={
                <Button
                  variant='ghost'
                  tone='muted'
                  size='icon'
                  className={
                    value === 'full_access'
                      ? 'text-status-attention enabled:hover:text-status-attention aria-expanded:text-status-attention'
                      : undefined
                  }
                />
              }
            />
          }
        >
          <Icon className='size-3.5' />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start' className='w-max min-w-32'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isMode(next)) onChange(next)
          }}
        >
          {Object.entries(modes).map(([id, mode]) => (
            <DropdownMenuRadioItem key={id} value={id}>
              <mode.Icon className='text-muted-foreground' />
              {mode.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

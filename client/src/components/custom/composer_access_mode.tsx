import type { PermissionMode, ProviderModel } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CommentIcon, SearchIcon, UnlockIcon } from '@primer/octicons-react'

import { DisabledTooltip } from './disabled_tooltip'

const modes: Record<PermissionMode, { label: string; Icon: typeof SearchIcon }> = {
  auto: { label: 'Auto', Icon: SearchIcon },
  full_access: { label: 'Full access', Icon: UnlockIcon },
}

function isMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && Object.hasOwn(modes, value)
}

export function ComposerAccessMode({
  value,
  model,
  onChange,
}: {
  value: PermissionMode
  model?: ProviderModel
  onChange: (value: PermissionMode) => void
}) {
  if (model?.autoMode === false)
    return (
      <DisabledTooltip reason={`${model.name} only supports asking first`} wrap='flex'>
        <Button
          variant='ghost'
          tone='muted'
          size='icon'
          disabled
          aria-label='Access mode: Asks first'
          className='pointer-events-none'
        >
          <CommentIcon className='size-3.5' />
        </Button>
      </DisabledTooltip>
    )
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

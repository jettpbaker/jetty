import type { PermissionMode, ProviderModel } from '@jetty/shared/wire'

import {
  ChevronDownSmallIcon,
  ShieldKeyholeIcon,
  ShieldCheckIcon,
  ShieldBreakIcon,
} from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useHotkey } from '@tanstack/react-hotkeys'
import { use, useState } from 'react'

import { ComposerMenuAnchorContext } from './composer_menu_anchor'
import { DisabledTooltip } from './disabled_tooltip'
import { KeybindTooltip, keybinds, appShortcut } from './keybinds'

export const accessModes: Record<
  PermissionMode,
  { label: string; menuLabel: string; description: string; Icon: typeof ShieldCheckIcon }
> = {
  auto: {
    label: 'Ask for approval',
    menuLabel: 'Ask for approval',
    description: 'Allows routine work; asks before restricted actions',
    Icon: ShieldCheckIcon,
  },
  full_access: {
    label: 'Full access',
    menuLabel: 'Full access',
    description: 'Runs commands and edits without asking',
    Icon: ShieldBreakIcon,
  },
}

function isMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && Object.hasOwn(accessModes, value)
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
  const anchor = use(ComposerMenuAnchorContext)
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  const choosable = model?.autoMode !== false
  useHotkey(
    keybinds.access.hotkey,
    (event) => {
      if (appShortcut(event)) {
        setInstant(true)
        setOpen(true)
      }
    },
    { enabled: choosable, requireReset: true, ignoreInputs: false }
  )
  if (!choosable)
    return (
      <DisabledTooltip reason={`${model.name} only supports asking first`} wrap='flex'>
        <Button
          variant='ghost-text'
          size='sm'
          disabled
          aria-label='Access mode: Asks first'
          className='pointer-events-none'
        >
          <ShieldKeyholeIcon />
          Asks first
        </Button>
      </DisabledTooltip>
    )
  const { label, Icon } = accessModes[value]
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next, details) => {
        setInstant(next && details.event.type === 'keydown')
        setOpen(next)
      }}
    >
      <KeybindTooltip
        binding={{
          ...keybinds.access,
          name: `${accessModes[value].menuLabel}: ${accessModes[value].description}`,
        }}
      >
        <DropdownMenuTrigger
          aria-label={`Access mode: ${label}`}
          render={
            <Button variant='ghost-text' size='sm' className='gap-1.5 text-13 text-foreground' />
          }
        >
          <Icon className='text-muted-foreground' />
          <span>{value === 'auto' ? 'Approval' : label}</span>
          <ChevronDownSmallIcon className='text-muted-foreground' />
        </DropdownMenuTrigger>
      </KeybindTooltip>
      <DropdownMenuContent
        anchor={anchor}
        side='top'
        sideOffset={8}
        align='start'
        className={cn('w-80 max-w-[calc(100vw-24px)]', instant && 'data-open:animate-none')}
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isMode(next)) onChange(next)
          }}
        >
          {Object.entries(accessModes).map(([id, mode]) => (
            <DropdownMenuRadioItem
              key={id}
              value={id}
              className='h-auto! items-start py-2 data-checked:bg-accent [&>[data-slot=dropdown-menu-radio-item-indicator]]:top-2.5'
            >
              <mode.Icon className='mt-0.5' />
              <span className='flex min-w-0 flex-col gap-0.5'>
                <span>{mode.menuLabel}</span>
                <span className='text-xs leading-4 text-muted-foreground whitespace-normal'>
                  {mode.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

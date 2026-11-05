import type { PermissionMode, ProviderModel } from '@jetty/shared/wire'

import {
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
import { useHotkey } from '@tanstack/react-hotkeys'
import { useState } from 'react'

import { DisabledTooltip } from './disabled_tooltip'
import { KeybindTooltip, keybinds, appShortcut } from './keybinds'

export const accessModes: Record<
  PermissionMode,
  { label: string; description: string; Icon: typeof ShieldCheckIcon }
> = {
  auto: {
    label: 'Ask for approval',
    description: 'Allows routine work; asks before restricted actions',
    Icon: ShieldCheckIcon,
  },
  full_access: {
    label: 'Full access',
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
  const [open, setOpen] = useState(false)
  const choosable = model?.autoMode !== false
  useHotkey(
    keybinds.access.hotkey,
    (event) => {
      if (appShortcut(event)) setOpen(true)
    },
    { enabled: choosable, requireReset: true, ignoreInputs: false }
  )
  if (!choosable)
    return (
      <DisabledTooltip reason={`${model.name} only supports asking first`} wrap='flex'>
        <Button
          variant='ghost'
          size='icon'
          disabled
          aria-label='Access mode: Asks first'
          className='pointer-events-none'
        >
          <ShieldKeyholeIcon />
        </Button>
      </DisabledTooltip>
    )
  const { label, Icon } = accessModes[value]
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <KeybindTooltip binding={{ ...keybinds.access, name: label }}>
        <DropdownMenuTrigger
          aria-label={`Access mode: ${label}`}
          render={<Button variant='ghost' size='sm' />}
        >
          <Icon />
          {value === 'auto' ? 'Auto' : label}
        </DropdownMenuTrigger>
      </KeybindTooltip>
      <DropdownMenuContent side='top' sideOffset={6} align='start' className='w-64'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isMode(next)) onChange(next)
          }}
        >
          {Object.entries(accessModes).map(([id, mode]) => (
            <DropdownMenuRadioItem key={id} value={id} className='h-auto! py-2'>
              <mode.Icon />
              <span className='flex min-w-0 flex-col gap-0.5'>
                <span>{mode.label}</span>
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

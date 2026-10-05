import type { PermissionMode, ProviderModel } from '@jetty/shared/wire'

import {
  ShieldQuestionMarkIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from '@/components/custom/huge_icons'
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
import { KeybindTooltip, keybinds, typingOutsideComposer } from './keybinds'

const modes: Record<PermissionMode, { label: string; Icon: typeof ShieldCheckIcon }> = {
  auto: { label: 'Auto', Icon: ShieldCheckIcon },
  full_access: { label: 'Full access', Icon: ShieldOffIcon },
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
  const [open, setOpen] = useState(false)
  const choosable = model?.autoMode !== false
  useHotkey(
    keybinds.access.hotkey,
    (event) => {
      if (!typingOutsideComposer(event)) setOpen(true)
    },
    { enabled: choosable, requireReset: true, ignoreInputs: false }
  )
  if (!choosable)
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
          <ShieldQuestionMarkIcon className='size-3.5' />
        </Button>
      </DisabledTooltip>
    )
  const { label, Icon } = modes[value]
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <KeybindTooltip binding={{ ...keybinds.access, name: label }}>
        <DropdownMenuTrigger
          aria-label={`Access mode: ${label}`}
          render={
            <Button
              variant='ghost'
              tone='muted'
              size='icon'
              className={
                value === 'full_access'
                  ? 'text-status-attention not-disabled:hover:text-status-attention aria-expanded:text-status-attention'
                  : undefined
              }
            />
          }
        >
          <Icon className='size-3.5' />
        </DropdownMenuTrigger>
      </KeybindTooltip>
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

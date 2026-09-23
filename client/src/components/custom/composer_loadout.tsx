import type { Loadout } from '@/state'
import type { EffortLevel, PermissionMode } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const models = [
  { id: 'default', label: 'Default' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'grok-build', label: 'Grok' },
  { id: 'gpt-6-astra', label: 'Astra' },
] as const

const efforts = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
] as const

const permissions = [
  { id: 'auto', label: 'Auto' },
  { id: 'full_access', label: 'Full access' },
] as const

const effortLabels: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

const permissionLabels: Record<PermissionMode, string> = {
  auto: 'Auto',
  full_access: 'Full access',
}

const subTriggerClass = 'gap-1 [&>svg:last-child]:ml-0 [&>svg:last-child]:text-muted-foreground'

function isEffort(value: string): value is EffortLevel {
  return efforts.some((effort) => effort.id === value)
}

function isPermission(value: string): value is PermissionMode {
  return permissions.some((permission) => permission.id === value)
}

export function ComposerLoadout({
  loadout,
  onChange,
}: {
  loadout: Loadout
  onChange: (loadout: Loadout) => void
}) {
  const modelId = loadout.model ?? 'default'
  const modelLabel =
    models.find((model) => model.id === modelId)?.label ?? loadout.model ?? 'Default'
  return (
    <div className='flex items-center gap-1.5'>
      <span className='px-2 text-xs text-muted-foreground'>Session</span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`Loadout: Session, ${modelLabel}, ${effortLabels[loadout.effort]}, ${permissionLabels[loadout.permissionMode]}`}
          render={
            <Button
              variant='ghost'
              size='sm'
              className='group/chip gap-1.5 rounded-sm text-primary enabled:hover:text-primary aria-expanded:text-primary'
            />
          }
        >
          {modelLabel}
          <span className='text-muted-foreground group-hover/chip:text-foreground group-aria-expanded/chip:text-foreground'>
            {effortLabels[loadout.effort]}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='w-max min-w-56'>
          <DropdownMenuGroup>
            <DropdownMenuLabel className='flex items-center'>
              Provider
              <span className='ml-auto pl-4 font-normal text-muted-foreground'>Session</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTriggerClass}>
                Model
                <span className='ml-auto pl-4 text-muted-foreground'>{modelLabel}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={modelId}
                  onValueChange={(id) => {
                    const next = String(id)
                    onChange({
                      ...loadout,
                      model: next === 'default' ? undefined : next,
                    })
                  }}
                >
                  {models.map((model) => (
                    <DropdownMenuRadioItem key={model.id} value={model.id}>
                      {model.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTriggerClass}>
                Effort
                <span className='ml-auto pl-4 text-muted-foreground'>
                  {effortLabels[loadout.effort]}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={loadout.effort}
                  onValueChange={(id) => {
                    const effort = String(id)
                    if (isEffort(effort)) onChange({ ...loadout, effort })
                  }}
                >
                  {efforts.map((effort) => (
                    <DropdownMenuRadioItem key={effort.id} value={effort.id}>
                      {effort.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTriggerClass}>
                Permission
                <span className='ml-auto pl-4 text-muted-foreground'>
                  {permissionLabels[loadout.permissionMode]}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={loadout.permissionMode}
                  onValueChange={(id) => {
                    const permissionMode = String(id)
                    if (isPermission(permissionMode)) onChange({ ...loadout, permissionMode })
                  }}
                >
                  {permissions.map((permission) => (
                    <DropdownMenuRadioItem key={permission.id} value={permission.id}>
                      {permission.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

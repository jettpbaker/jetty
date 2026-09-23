import type { Loadout } from '@/state'
import type { EffortLevel, PermissionMode, ProviderId } from '@jetty/shared/wire'

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

const providers = [
  { id: 'grok', label: 'Grok' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
] as const

const providerLabels: Record<ProviderId, string> = {
  grok: 'Grok',
  codex: 'Codex',
  claude: 'Claude',
}

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

function isProvider(value: string): value is ProviderId {
  return providers.some((provider) => provider.id === value)
}

export function ComposerLoadout({
  loadout,
  onChange,
  provider,
  providerDisabled,
}: {
  loadout: Loadout
  onChange: (loadout: Loadout) => void
  provider: ProviderId
  providerDisabled: boolean
}) {
  const modelId = loadout.model ?? 'default'
  const modelLabel =
    models.find((model) => model.id === modelId)?.label ?? loadout.model ?? 'Default'
  const providerLabel = providerLabels[provider]
  return (
    <div className='flex items-center gap-1.5'>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`Loadout: ${providerLabel}, ${modelLabel}, ${effortLabels[loadout.effort]}, ${permissionLabels[loadout.permissionMode]}`}
          render={
            <Button
              variant='ghost'
              size='sm'
              className='group/chip gap-1.5 rounded-sm text-primary enabled:hover:text-primary aria-expanded:text-primary'
            />
          }
        >
          <span className='text-muted-foreground group-hover/chip:text-foreground group-aria-expanded/chip:text-foreground'>
            {providerLabel}
          </span>
          {modelLabel}
          <span className='text-muted-foreground group-hover/chip:text-foreground group-aria-expanded/chip:text-foreground'>
            {effortLabels[loadout.effort]}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='w-max min-w-56'>
          <DropdownMenuGroup>
            {providerDisabled ? (
              <DropdownMenuLabel className='flex items-center'>
                Provider
                <span className='ml-auto pl-4 font-normal text-muted-foreground'>
                  {providerLabel}
                </span>
              </DropdownMenuLabel>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={subTriggerClass}>
                  Provider
                  <span className='ml-auto pl-4 text-muted-foreground'>{providerLabel}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={provider}
                    onValueChange={(id) => {
                      const next = String(id)
                      if (isProvider(next)) onChange({ ...loadout, provider: next })
                    }}
                  >
                    {providers.map((item) => (
                      <DropdownMenuRadioItem key={item.id} value={item.id}>
                        {item.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
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

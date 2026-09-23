import type { Loadout } from '@/state'
import type { EffortLevel, ProviderId } from '@jetty/shared/wire'

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

const models: Record<string, string> = {
  default: 'Default',
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  'grok-build': 'Grok',
  'gpt-6-astra': 'Astra',
}

const providers: Record<ProviderId, string> = {
  grok: 'Grok',
  codex: 'Codex',
  claude: 'Claude',
}

const efforts: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

function LoadoutMenu<K extends string>({
  label,
  valueLabel,
  value,
  options,
  onSelect,
}: {
  label: string
  valueLabel: string
  value: K
  options: Record<K, string>
  onSelect: (value: K) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className='gap-1 [&>svg:last-child]:ml-0 [&>svg:last-child]:text-muted-foreground'>
        {label}
        <span className='ml-auto pl-4 text-muted-foreground'>{valueLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(id) => {
            const next = String(id)
            if (Object.hasOwn(options, next)) onSelect(next as K)
          }}
        >
          {Object.entries<string>(options).map(([id, optionLabel]) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {optionLabel}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
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
  const modelLabel = models[modelId] ?? modelId
  const providerLabel = providers[provider]
  const effortLabel = efforts[loadout.effort]
  return (
    <div className='flex items-center gap-1.5'>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`Loadout: ${providerLabel}, ${modelLabel}, ${effortLabel}`}
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
            {effortLabel}
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
              <LoadoutMenu
                label='Provider'
                valueLabel={providerLabel}
                value={provider}
                options={providers}
                onSelect={(next) => onChange({ ...loadout, provider: next })}
              />
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <LoadoutMenu
              label='Model'
              valueLabel={modelLabel}
              value={modelId}
              options={models}
              onSelect={(next) =>
                onChange({ ...loadout, model: next === 'default' ? undefined : next })
              }
            />
            <LoadoutMenu
              label='Effort'
              valueLabel={effortLabel}
              value={loadout.effort}
              options={efforts}
              onSelect={(effort) => onChange({ ...loadout, effort })}
            />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

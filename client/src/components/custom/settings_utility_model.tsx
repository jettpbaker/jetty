import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useChrome } from '@/state'
import { useSetUtilityModel } from '@/state/models'
import { resolveUtilityModel, type ModelRef } from '@jetty/shared/wire'
import { CaretDownIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import './settings_sections.css'
import { ProviderGlyph } from './provider_glyph'
import { providerOptions } from './settings_providers'

const automaticKey = 'automatic'

function modelKey(model: ModelRef) {
  return `${model.provider}:${model.id}`
}

export function SettingsUtilityModel() {
  const chrome = useChrome()
  const setUtilityModel = useSetUtilityModel()
  const [pending, setPending] = useState<ModelRef | null>()
  const models = chrome?.models ?? []
  const choice = pending === undefined ? (chrome?.utilityModel ?? null) : pending
  const chosen = choice && models.find((model) => modelKey(model) === modelKey(choice))
  const automatic = resolveUtilityModel(null, models)
  const groups = providerOptions
    .map((provider) => ({
      provider,
      models: models.filter((model) => model.provider === provider.id),
    }))
    .filter((group) => group.models.length > 0)
  function pick(key: string) {
    const model = models.find((candidate) => modelKey(candidate) === key)
    const next = model ? { provider: model.provider, id: model.id } : null
    setPending(next)
    setUtilityModel(next, () => setPending(undefined))
  }
  const label = chosen ? chosen.name : 'Automatic'
  return (
    <div className='appearance-option-row'>
      <span>Titles and review</span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`Titles and review: ${label}`}
          render={
            <Button
              variant='ghost'
              size='sm'
              className='h-7 gap-1.5 rounded-sm text-xs text-muted-foreground'
            />
          }
        >
          {label}
          <CaretDownIcon className='size-3' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='min-w-48'>
          <DropdownMenuRadioGroup
            value={chosen ? modelKey(chosen) : automaticKey}
            onValueChange={(value) => pick(String(value))}
          >
            <DropdownMenuRadioItem value={automaticKey}>
              Automatic
              <span className='ml-auto text-muted-foreground'>{automatic?.name ?? 'None'}</span>
            </DropdownMenuRadioItem>
            {groups.map(({ provider, models }) => (
              <DropdownMenuGroup key={provider.id}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className='flex items-center gap-2 [&>.provider-icon]:size-3'>
                  <ProviderGlyph provider={provider.id} className='size-3' />
                  {provider.name}
                </DropdownMenuLabel>
                {models.map((model) => (
                  <DropdownMenuRadioItem key={modelKey(model)} value={modelKey(model)}>
                    {model.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

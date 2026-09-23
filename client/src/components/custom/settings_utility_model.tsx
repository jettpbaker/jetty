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
import { effortLabels, findModel, modelKey } from '@/lib/loadout'
import { useChrome } from '@/state'
import { useSetUtilityModel } from '@/state/models'
import { resolveUtilityEffort, resolveUtilityModel, type UtilityModel } from '@jetty/shared/wire'
import { CaretDownIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import './settings_sections.css'
import { subTriggerClass } from './composer_loadout'
import { ProviderGlyph } from './provider_glyph'
import { providerOptions } from './settings_providers'

const automaticKey = 'automatic'

export function SettingsUtilityModel() {
  const chrome = useChrome()
  const setUtilityModel = useSetUtilityModel()
  const [pending, setPending] = useState<UtilityModel>()
  const models = chrome?.models ?? []
  const choice = pending ?? chrome?.utilityModel ?? { model: null }
  const chosen =
    choice.model && findModel(models, { provider: choice.model.provider, model: choice.model.id })
  const automatic = resolveUtilityModel(null, models)
  const resolved = chosen || automatic
  const efforts = resolved?.efforts ?? []
  const effort = resolved && resolveUtilityEffort(resolved, choice.effort)
  const groups = providerOptions
    .map((provider) => ({
      provider,
      models: models.filter((model) => model.provider === provider.id),
    }))
    .filter((group) => group.models.length > 0)
  function save(next: UtilityModel) {
    setPending(next)
    setUtilityModel(next, () => setPending(undefined))
  }
  function pickModel(key: string) {
    const model = models.find((candidate) => modelKey(candidate) === key)
    save({ ...choice, model: model ? { provider: model.provider, id: model.id } : null })
  }
  const name = chosen ? chosen.name : 'Automatic'
  const label = [name, effort && effortLabels[effort]].filter(Boolean).join(' · ')
  return (
    <div className='appearance-option-row'>
      <div className='flex flex-col gap-1'>
        <span>Utility model</span>
        <p className='text-xs text-muted-foreground'>
          Names threads and flags replies that are ready for review.
        </p>
      </div>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`Utility model: ${label}`}
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
        <DropdownMenuContent align='end' className='w-max min-w-48'>
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTriggerClass}>
                Model
                <span className='ml-auto pl-4 text-muted-foreground'>{name}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className='min-w-48'>
                <DropdownMenuRadioGroup
                  value={chosen ? modelKey(chosen) : automaticKey}
                  onValueChange={(value) => pickModel(String(value))}
                >
                  <DropdownMenuRadioItem value={automaticKey}>
                    Automatic
                    <span className='ml-auto text-muted-foreground'>
                      {automatic?.name ?? 'None'}
                    </span>
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {efforts.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={subTriggerClass}>
                  Effort
                  <span className='ml-auto pl-4 text-muted-foreground'>
                    {effort && effortLabels[effort]}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={effort ?? ''}
                    onValueChange={(next) => {
                      const level = efforts.find((candidate) => candidate === next)
                      if (level) save({ ...choice, effort: level })
                    }}
                  >
                    {efforts.map((level) => (
                      <DropdownMenuRadioItem key={level} value={level}>
                        {effortLabels[level]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

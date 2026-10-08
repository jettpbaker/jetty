import type { ProviderModel } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  clearSlot,
  effortLabels,
  equipModel,
  findModel,
  modelKey,
  type LoadoutSlot,
} from '@/lib/loadout'
import { cn } from '@/lib/utils'
import { useLoadouts } from '@/state'
import { useChrome } from '@/state/chrome'
import { useModelAvailability, useProviderEnabled } from '@/state/loadouts'
import { useModelRefresh } from '@/state/models'
import { PointerActivationConstraints, PointerSensor, KeyboardSensor } from '@dnd-kit/dom'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import { moveOnKeys, subTriggerClass } from './composer_loadout'
import { ArrowDown01Icon, FlashIcon, PlusSignIcon, Refresh01Icon } from './huge_icons'
import { ModelLabel } from './model_label'
import { ProviderGlyph } from './provider_glyph'
import { SettingsPage, SettingsSection, cardClass, selectTriggerClass } from './settings_layout'

const providers = [
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'grok', name: 'Grok' },
] as const

const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
  KeyboardSensor,
]

type ModelGroup = { provider: (typeof providers)[number]; models: ProviderModel[] }

function describe(slot: LoadoutSlot) {
  return [slot.effort && effortLabels[slot.effort], slot.fast && 'Fast'].filter(Boolean).join(' · ')
}

function ModelChoices({
  groups,
  onPick,
}: {
  groups: readonly ModelGroup[]
  onPick: (model: ProviderModel) => void
}) {
  return groups.map(({ provider, models }, index) => (
    <DropdownMenuGroup key={provider.id}>
      {index > 0 && <DropdownMenuSeparator />}
      <DropdownMenuLabel className='flex items-center gap-2 [&>.provider-icon]:size-3'>
        <ProviderGlyph provider={provider.id} />
        {provider.name}
      </DropdownMenuLabel>
      {models.map((model) => (
        <DropdownMenuItem key={modelKey(model)} onClick={() => onPick(model)}>
          <ModelLabel model={model} />
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  ))
}

function SlotRow({
  slot,
  index,
  catalog,
  groups,
  onChange,
  onClear,
  onMove,
}: {
  slot: LoadoutSlot
  index: number
  catalog: readonly ProviderModel[]
  groups: readonly ModelGroup[]
  onChange: (slot: LoadoutSlot, message: string) => void
  onClear: () => void
  onMove: (from: number, to: number) => void
}) {
  const reducedMotion = useReducedMotion()
  const model = findModel(catalog, slot)
  const { ref, handleRef, isDragging } = useSortable({
    id: slot.id,
    index,
    group: 'loadout',
    disabled: { draggable: !model },
    transition: reducedMotion ? null : { duration: 150, easing: 'ease-out' },
  })
  function equip(next: ProviderModel) {
    onChange(equipModel(slot, next), `${next.name} in slot ${index + 1}.`)
  }
  const number = (
    <span className='w-3 shrink-0 font-mono text-xs text-muted-foreground'>{index + 1}</span>
  )
  return (
    <div
      ref={ref}
      className={cn(
        'relative flex min-h-13 items-center gap-3 py-2.5',
        isDragging && 'z-10 -mx-4 rounded-md bg-popover px-4 shadow-md'
      )}
    >
      {model ? (
        <>
          <button
            ref={handleRef}
            type='button'
            aria-label={`Slot ${index + 1}: ${[model.name, describe(slot)].filter(Boolean).join(', ')}. Drag to reorder`}
            title='Drag to reorder · Option+Shift+↑/↓'
            aria-keyshortcuts='Alt+Shift+ArrowUp Alt+Shift+ArrowDown'
            onKeyDown={moveOnKeys(index, onMove)}
            className='absolute inset-0 cursor-grab touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing'
          />
          {number}
          <span className='pointer-events-none flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/6 [&>.provider-icon]:size-3.5'>
            <ProviderGlyph provider={model.provider} />
          </span>
          <span className='pointer-events-none grow text-13'>
            <ModelLabel model={model} />
          </span>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              aria-label={[`Configure slot ${index + 1}`, describe(slot)]
                .filter(Boolean)
                .join(': ')}
              render={
                <Button
                  variant='ghost'
                  className={cn(selectTriggerClass, 'relative text-muted-foreground')}
                />
              }
            >
              {slot.fast && <FlashIcon filled />}
              {slot.effort && effortLabels[slot.effort]}
              <ArrowDown01Icon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='min-w-44'>
              {model.efforts.length > 0 && (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Effort</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={slot.effort}
                    onValueChange={(value) => {
                      const effort = model.efforts.find((level) => level === value)
                      if (effort)
                        onChange({ ...slot, effort }, `Slot ${index + 1}: ${effortLabels[effort]}.`)
                    }}
                  >
                    {model.efforts.map((effort) => (
                      <DropdownMenuRadioItem key={effort} value={effort}>
                        {effortLabels[effort]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              )}
              {model.fast && (
                <>
                  {model.efforts.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuCheckboxItem
                    className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
                    checked={slot.fast}
                    closeOnClick={false}
                    onCheckedChange={(fast) =>
                      onChange({ ...slot, fast }, `Slot ${index + 1}: Fast ${fast ? 'on' : 'off'}.`)
                    }
                  >
                    <FlashIcon filled={slot.fast} />
                    Fast
                    <Switch
                      render={<span />}
                      size='sm'
                      checked={slot.fast}
                      tabIndex={-1}
                      aria-hidden='true'
                      className='pointer-events-none ml-auto'
                    />
                  </DropdownMenuCheckboxItem>
                </>
              )}
              {(model.efforts.length > 0 || model.fast) && <DropdownMenuSeparator />}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={subTriggerClass}>
                  Change model
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className='min-w-48'>
                  <ModelChoices groups={groups} onPick={equip} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={onClear}>Remove from loadout</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={`Add a model to slot ${index + 1}`}
            title='Option+Shift+↑/↓ to reorder'
            onKeyDown={moveOnKeys(index, onMove)}
            className='group/add flex grow items-center gap-3 rounded-sm text-left text-13 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
          >
            {number}
            {/* Without a handle, dnd-kit would mark the whole slot a disabled button. */}
            <span
              ref={handleRef}
              aria-hidden='true'
              className='flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-border [&_svg]:size-3.5'
            >
              <PlusSignIcon />
            </span>
            Add a model
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='min-w-48'>
            <ModelChoices groups={groups} onPick={equip} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function Loadout() {
  const { loadouts: slots, catalog, setLoadouts } = useLoadouts()
  const [enabledProviders] = useProviderEnabled()
  const [announcement, setAnnouncement] = useState('')
  const groups = providers
    .filter((provider) => enabledProviders[provider.id])
    .map((provider) => ({
      provider,
      models: catalog.filter((model) => model.provider === provider.id),
    }))
    .filter((group) => group.models.length > 0)
  function save(next: LoadoutSlot[], message: string) {
    setAnnouncement(
      setLoadouts(next)
        ? message
        : `${message} Changes are available for this visit; browser storage is unavailable.`
    )
  }
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= slots.length) return
    const next = [...slots]
    next.splice(to, 0, ...next.splice(from, 1))
    save(next, 'Loadout reordered.')
  }
  return (
    <DragDropProvider
      sensors={sensors}
      onDragEnd={(event) => {
        const { source } = event.operation
        if (event.canceled || !source || !isSortable(source)) return
        move(source.initialIndex, source.index)
      }}
    >
      <div
        role='group'
        aria-label='Model loadout'
        className={cn(cardClass, 'flex flex-col divide-y divide-border px-4')}
      >
        {slots.map((slot, index) => (
          <SlotRow
            key={slot.id}
            slot={slot}
            index={index}
            catalog={catalog}
            groups={groups}
            onMove={move}
            onClear={() => save(clearSlot(slots, slot.id), `Slot ${index + 1} cleared.`)}
            onChange={(next, message) =>
              save(
                slots.map((item) => (item.id === slot.id ? next : item)),
                message
              )
            }
          />
        ))}
      </div>
      <p role='status' aria-live='polite' className='sr-only'>
        {announcement}
      </p>
    </DragDropProvider>
  )
}

function AvailableModels() {
  const { catalog, enabled, setEnabled } = useModelAvailability()
  const [enabledProviders] = useProviderEnabled()
  const discovery = useChrome()?.modelDiscovery
  return (
    <div className={cn(cardClass, 'flex gap-6 px-4 pt-3.5 pb-2.5')}>
      {providers.map((provider) => {
        const models = catalog.filter((model) => model.provider === provider.id)
        const on = enabledProviders[provider.id]
        return (
          <div
            key={provider.id}
            role='group'
            aria-label={`${provider.name} models`}
            className='flex min-w-0 grow basis-0 flex-col'
          >
            <h3 className='flex h-6 items-center gap-1.5 text-xs font-medium text-muted-foreground [&>.provider-icon]:size-3'>
              <ProviderGlyph provider={provider.id} />
              {provider.name}
            </h3>
            {models.map((model) => {
              const checked = enabled[modelKey(model)] ?? true
              return (
                <div
                  key={modelKey(model)}
                  className={cn(
                    'flex h-8 items-center gap-2 text-13',
                    (!on || !checked) && 'text-muted-foreground'
                  )}
                >
                  <span className='grow truncate'>
                    <ModelLabel model={model} />
                  </span>
                  <Switch
                    size='sm'
                    aria-label={`Show ${model.name} in pickers`}
                    disabled={!on}
                    checked={checked}
                    onCheckedChange={(next) => setEnabled(model, next)}
                  />
                </div>
              )
            })}
            {!models.length && (
              <p className='py-2 text-xs text-muted-foreground'>
                {discovery?.[provider.id] === 'error'
                  ? 'Couldn’t list models. Refresh to try again.'
                  : discovery?.[provider.id] === 'ready'
                    ? 'No models found'
                    : 'Checking models…'}
              </p>
            )}
            {!on && models.length > 0 && (
              <p className='py-1 text-xs text-muted-foreground'>Off in Connected accounts</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SettingsModels() {
  const { refreshing, refresh } = useModelRefresh()
  useEffect(() => {
    refresh()
  }, [refresh])
  return (
    <SettingsPage
      title='Models'
      description='The loadout you switch between, and which models show up in pickers.'
    >
      <SettingsSection
        id='loadout'
        title='Loadout'
        description='Five slots to switch between in the composer. Drag to reorder.'
      >
        <Loadout />
      </SettingsSection>
      <SettingsSection
        id='available-models'
        title='Available models'
        description='Turn off the ones you never reach for.'
        action={
          <div className='flex shrink-0 items-center gap-2 pr-1'>
            {refreshing && <span className='text-xs text-muted-foreground'>Checking…</span>}
            <Button
              variant='ghost'
              className='h-7 gap-1.5 rounded-sm pr-2.5 pl-2 text-13'
              aria-busy={refreshing}
              onClick={() => refresh(true)}
            >
              {refreshing ? <Spinner /> : <Refresh01Icon />}
              Refresh
            </Button>
          </div>
        }
      >
        <AvailableModels />
      </SettingsSection>
    </SettingsPage>
  )
}

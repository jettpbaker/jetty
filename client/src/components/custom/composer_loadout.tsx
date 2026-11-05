import type { ProviderId, ProviderModel } from '@jetty/shared/wire'
import type { KeyboardEvent, RefObject, SyntheticEvent } from 'react'

import { ArrowUpRightIcon, DotGrid2x3Icon, PlusMediumIcon } from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  describeLoadout,
  effortLabels,
  equipModel,
  findModel,
  modelKey,
  sameLoadoutIn,
  slotLoadout,
  type Loadout,
  type LoadoutSlot,
} from '@/lib/loadout'
import { cn } from '@/lib/utils'
import { useModels } from '@/state'
import { useModelRefresh } from '@/state/models'
import { PointerSensor, PointerActivationConstraints } from '@dnd-kit/dom'
import { RestrictToElement } from '@dnd-kit/dom/modifiers'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable, isSortable } from '@dnd-kit/react/sortable'
import { catalogModelName, modelLabelText } from '@jetty/shared/model-name'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useReducedMotion } from 'motion/react'
import { useRef, useState } from 'react'

import { DisabledTooltip } from './disabled_tooltip'
import { KeybindChip, KeybindTooltip, keybinds, appShortcut } from './keybinds'
import './option_picker.css'
import { ModelLabel } from './model_label'
import { ProviderGlyph } from './provider_glyph'

export const subTriggerClass = 'gap-1 [&>svg:last-child]:ml-0'
const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
]
const modifiers = [
  RestrictToElement.configure({
    element: (operation) => operation.source?.element?.closest('[data-loadout-group]') ?? null,
  }),
]

function stopSelect(event: SyntheticEvent) {
  event.preventDefault()
  event.stopPropagation()
}

export function moveOnKeys(index: number, onMove: (from: number, to: number) => void) {
  return (event: KeyboardEvent) => {
    if (!event.altKey || !event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    onMove(index, index + (event.key === 'ArrowUp' ? -1 : 1))
  }
}

function DragHandle({
  handleRef,
  isDragging,
}: {
  handleRef: (element: Element | null) => void
  isDragging: boolean
}) {
  return (
    <span
      ref={handleRef}
      aria-hidden='true'
      tabIndex={-1}
      className={`-my-0.5 -ml-1.5 flex h-8 w-7 shrink-0 touch-none items-center justify-center ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onClick={stopSelect}
      onPointerUp={stopSelect}
    >
      <DotGrid2x3Icon className='size-4! text-muted-foreground' />
    </span>
  )
}

function SortableLoadoutItem({
  id,
  index,
  name,
  details,
  provider,
  disabled,
  disabledReason,
  draggable,
  checked,
  onMove,
  onSelect,
}: {
  id: string
  index: number
  name: string
  details: string
  provider: ProviderId
  disabled: boolean
  disabledReason?: string
  draggable: boolean
  checked: boolean
  onMove: (from: number, to: number) => void
  onSelect: () => void
}) {
  const reducedMotion = useReducedMotion()
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    transition: reducedMotion ? null : { duration: 150, easing: 'ease-out' },
  })
  return (
    <DisabledTooltip
      reason={disabled ? (disabledReason ?? 'Threads can’t switch providers') : undefined}
      side='right'
    >
      <CommandItem
        ref={ref}
        value={`configuration:${id}`}
        disabled={disabled}
        data-checked={checked}
        data-loadout-index={index}
        title={draggable ? 'Drag to reorder · Option+Shift+↑/↓' : undefined}
        aria-keyshortcuts={draggable ? 'Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : undefined}
        onKeyDown={moveOnKeys(index, onMove)}
        onSelect={onSelect}
      >
        {draggable && <DragHandle handleRef={handleRef} isDragging={isDragging} />}
        <ProviderGlyph provider={provider} className='size-3' />
        <span className='min-w-0 flex-1 truncate'>
          {name} <span className='text-muted-foreground'>{details}</span>
        </span>
      </CommandItem>
    </DisabledTooltip>
  )
}

function LoadoutShortcuts({ openSubmenu }: { openSubmenu: (target: 'model' | 'effort') => void }) {
  useHotkey(
    keybinds.model.hotkey,
    (event) => {
      if (appShortcut(event)) openSubmenu('model')
    },
    { requireReset: true, ignoreInputs: false }
  )
  useHotkey(
    keybinds.effort.hotkey,
    (event) => {
      if (appShortcut(event)) openSubmenu('effort')
    },
    { requireReset: true, ignoreInputs: false }
  )
  return null
}

export function loadoutParts(
  catalog: readonly ProviderModel[],
  value: Loadout | undefined,
  allowedEfforts?: readonly ProviderModel['efforts'][number][]
) {
  const model = value && findModel(catalog, value)
  const name = value && catalogModelName(catalog, value.provider, value.model)
  const efforts = ((value && model?.efforts) ?? []).filter(
    (effort) => !allowedEfforts || allowedEfforts.includes(effort)
  )
  return { model, name, efforts }
}

export function ComposerLoadout({
  catalog,
  loadouts,
  usable,
  value,
  lockedProvider,
  disabledProviders = [],
  allowedEfforts,
  hotkeys = true,
  onChange,
  onReorder,
  onOpenSettings,
  loading = false,
  modelMenuRef,
}: {
  catalog: readonly ProviderModel[]
  loadouts: readonly LoadoutSlot[]
  // slots outside it stay listed, disabled
  usable: readonly LoadoutSlot[]
  value?: Loadout
  lockedProvider?: ProviderId
  disabledProviders?: readonly ProviderId[]
  allowedEfforts?: readonly ProviderModel['efforts'][number][]
  hotkeys?: boolean
  onChange: (loadout: Loadout) => void
  onReorder: (loadouts: LoadoutSlot[]) => void
  onOpenSettings: () => void
  // Until the catalog and the thread's own pick arrive, the chip keeps its space but stays hidden.
  loading?: boolean
  modelMenuRef?: RefObject<(() => void) | null>
}) {
  const { model, name, efforts } = loadoutParts(catalog, value, allowedEfforts)
  const allModels = useModels()
  const { refresh } = useModelRefresh()
  const equipped = loadouts.flatMap((slot) => {
    const loadout = slotLoadout(slot)
    return loadout ? [{ slot, loadout }] : []
  })
  const checked =
    (value && equipped.find(({ loadout }) => sameLoadoutIn(catalog, loadout, value))?.slot.id) ?? ''
  const models = lockedProvider
    ? catalog.filter((item) => item.provider === lockedProvider)
    : catalog

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [focusEffort, setFocusEffort] = useState(false)
  const effortRef = useRef<HTMLDivElement>(null)
  const search = query.trim().toLowerCase()
  const results = models.filter((item) =>
    `${item.provider} ${modelLabelText(item)}`.toLowerCase().includes(search)
  )
  const configurations = equipped.filter(({ loadout }) =>
    `${catalogModelName(allModels, loadout.provider, loadout.model)} ${describeLoadout(loadout)}`
      .toLowerCase()
      .includes(search)
  )

  function openSubmenu(target: 'model' | 'effort') {
    setFocusEffort(target === 'effort')
    setQuery('')
    setOpen(true)
    refresh()
  }

  if (modelMenuRef) modelMenuRef.current = () => openSubmenu('model')
  const shortcuts = hotkeys && <LoadoutShortcuts openSubmenu={openSubmenu} />

  function reorder(from: number, to: number) {
    const source = equipped[from]?.slot
    const target = equipped[to]?.slot
    if (from === to || !source || !target) return
    const sourceIndex = loadouts.findIndex((slot) => slot.id === source.id)
    const targetIndex = loadouts.findIndex((slot) => slot.id === target.id)
    const next = [...loadouts]
    next.splice(targetIndex, 0, ...next.splice(sourceIndex, 1))
    onReorder(next)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setFocusEffort(false)
          setQuery('')
          refresh()
        }
      }}
    >
      {shortcuts}
      <KeybindTooltip binding={keybinds.model}>
        <PopoverTrigger
          aria-label={
            value
              ? `Model: ${[name, describeLoadout(value)].filter(Boolean).join(', ')}`
              : 'Choose a model'
          }
          render={
            <Button
              variant='ghost'
              size='sm'
              tone={value ? 'default' : 'muted'}
              className={cn('group/chip gap-1.5 rounded-sm', loading && 'invisible')}
            />
          }
        >
          {value ? (
            <>
              <ProviderGlyph provider={value.provider} className='size-3' />
              {model ? <ModelLabel model={model} /> : name}
              <span className='text-muted-foreground'>{describeLoadout(value)}</span>
            </>
          ) : (
            'Choose a model'
          )}
        </PopoverTrigger>
      </KeybindTooltip>
      <PopoverContent
        side='top'
        sideOffset={6}
        align='start'
        className='search-picker w-86 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0'
        initialFocus={() =>
          focusEffort
            ? (effortRef.current?.querySelector<HTMLButtonElement>('[aria-pressed=true], button') ??
              true)
            : true
        }
      >
        <PopoverTitle className='sr-only'>Choose model and effort</PopoverTitle>
        <Command
          label='Choose a model'
          shouldFilter={false}
          onKeyDown={(event) => {
            const active = event.currentTarget.querySelector<HTMLElement>(
              '[data-selected=true][data-loadout-index]'
            )
            if (active && !search) moveOnKeys(Number(active.dataset.loadoutIndex), reorder)(event)
          }}
        >
          <CommandInput
            placeholder='Search models'
            aria-label='Search models'
            value={query}
            onValueChange={setQuery}
          />
          <Separator />
          <CommandList>
            <div className='picker-results'>
              {configurations.length > 0 && (
                <CommandGroup heading='Configurations'>
                  <DragDropProvider
                    sensors={sensors}
                    modifiers={modifiers}
                    onDragEnd={(event) => {
                      if (event.canceled) return
                      const { source } = event.operation
                      if (isSortable(source)) reorder(source.initialIndex, source.index)
                    }}
                  >
                    <fieldset data-loadout-group aria-label='Saved configurations'>
                      {configurations.map(({ slot, loadout }) => {
                        const index = equipped.findIndex((item) => item.slot.id === slot.id)
                        return (
                          <SortableLoadoutItem
                            key={slot.id}
                            id={slot.id}
                            index={index}
                            draggable={equipped.length > 1 && !search}
                            name={
                              catalogModelName(allModels, loadout.provider, loadout.model) ??
                              loadout.model
                            }
                            details={describeLoadout(loadout)}
                            provider={loadout.provider}
                            checked={checked === slot.id}
                            disabled={
                              !usable.some((item) => item.id === slot.id) ||
                              Boolean(lockedProvider && lockedProvider !== loadout.provider) ||
                              disabledProviders.includes(loadout.provider) ||
                              Boolean(
                                loadout.effort &&
                                allowedEfforts &&
                                !allowedEfforts.includes(loadout.effort)
                              )
                            }
                            disabledReason={
                              disabledProviders.includes(loadout.provider)
                                ? 'Claude bots only for now'
                                : loadout.effort &&
                                    allowedEfforts &&
                                    !allowedEfforts.includes(loadout.effort)
                                  ? 'Max effort is not available to bots'
                                  : undefined
                            }
                            onMove={reorder}
                            onSelect={() => {
                              onChange(loadout)
                              setOpen(false)
                            }}
                          />
                        )
                      })}
                    </fieldset>
                  </DragDropProvider>
                </CommandGroup>
              )}
              <CommandGroup heading='Models'>
                {results.map((item) => (
                  <CommandItem
                    key={modelKey(item)}
                    value={modelKey(item)}
                    disabled={disabledProviders.includes(item.provider)}
                    data-checked={!checked && model === item}
                    onSelect={() => onChange(equipModel(value ?? { fast: false }, item))}
                  >
                    <ProviderGlyph provider={item.provider} className='size-3' />
                    <span className='flex-1 truncate'>
                      <ModelLabel model={item} />
                    </span>
                  </CommandItem>
                ))}
                {!results.length && (
                  <p className='px-2 py-2 text-xs text-muted-foreground'>
                    {models.length
                      ? 'No matching models'
                      : 'Connect a coding agent in Settings to choose a model.'}
                  </p>
                )}
              </CommandGroup>
            </div>
          </CommandList>
        </Command>
        <Separator />
        <div ref={effortRef} className='flex flex-col gap-2 p-3'>
          <div className='flex items-center justify-between text-xs text-muted-foreground'>
            <span>Effort</span>
            {hotkeys && <KeybindChip binding={keybinds.effort} />}
          </div>
          {efforts.length ? (
            <ToggleGroup
              aria-label='Effort'
              size='sm'
              spacing={1}
              value={value?.effort ? [value.effort] : []}
              onValueChange={(next) => {
                const effort = efforts.find((level) => level === next[0])
                if (value && effort) onChange({ ...value, effort })
              }}
              className='w-full'
            >
              {efforts.map((effort) => (
                <ToggleGroupItem
                  key={effort}
                  value={effort}
                  className='h-7 min-w-0 flex-auto px-2 text-xs text-muted-foreground aria-pressed:bg-foreground/12 aria-pressed:text-foreground aria-pressed:inset-ring aria-pressed:inset-ring-primary/50'
                >
                  {effortLabels[effort]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : (
            <p className='text-xs text-muted-foreground'>
              {value ? `${name} doesn’t support effort levels` : 'Choose a model first'}
            </p>
          )}
          <DisabledTooltip
            reason={
              !value
                ? 'Choose a model first'
                : !model?.fast
                  ? `${name} has no fast mode`
                  : undefined
            }
          >
            <label className='flex h-8 items-center justify-between gap-3 text-xs'>
              Fast
              <Switch
                size='sm'
                disabled={!value || !model?.fast}
                checked={value?.fast ?? false}
                onCheckedChange={(fast) => value && onChange({ ...value, fast })}
              />
            </label>
          </DisabledTooltip>
        </div>
        <Separator />
        <Button
          variant='ghost'
          size='sm'
          className='m-1 justify-start'
          onClick={() => {
            setOpen(false)
            onOpenSettings()
          }}
        >
          {loadouts.some((slot) => !slotLoadout(slot)) ? <PlusMediumIcon /> : <ArrowUpRightIcon />}
          {loadouts.some((slot) => !slotLoadout(slot))
            ? 'Add configuration'
            : 'Manage configurations'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

// The composer menu's Model, Effort and Fast rows, shared with Settings' job models.
export function ModelMenuItems({
  catalog,
  models,
  value,
  allowedEfforts,
  disabledProviders = [],
  submenu,
  submenuRef,
  keybindChips = false,
  onChange,
}: {
  catalog: readonly ProviderModel[]
  // what the Model submenu lists
  models: readonly ProviderModel[]
  value?: Loadout
  allowedEfforts?: readonly ProviderModel['efforts'][number][]
  disabledProviders?: readonly ProviderId[]
  // the submenu a shortcut opened, which takes focus on its current pick
  submenu?: 'model' | 'effort'
  submenuRef?: RefObject<HTMLDivElement | null>
  keybindChips?: boolean
  onChange: (loadout: Loadout) => void
}) {
  const { model, name, efforts } = loadoutParts(catalog, value, allowedEfforts)

  function swapModel(key: string) {
    const next = models.find((item) => modelKey(item) === key)
    if (!next || disabledProviders.includes(next.provider)) return
    const { provider, model: id, effort, fast } = equipModel(value ?? { fast: false }, next)
    onChange({ provider, model: id, effort, fast })
  }

  return (
    <DropdownMenuGroup>
      <DropdownMenuSub defaultOpen={submenu === 'model'} closeParentOnEsc={submenu === 'model'}>
        <DropdownMenuSubTrigger className={subTriggerClass}>
          Model
          <span className='ml-auto pl-4 text-muted-foreground'>{name}</span>
          {keybindChips && <KeybindChip binding={keybinds.model} />}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent ref={submenu === 'model' ? submenuRef : undefined}>
          <DropdownMenuRadioGroup
            value={model ? modelKey(model) : ''}
            onValueChange={(key) => swapModel(String(key))}
          >
            {/* A model pick leaves the menu open, so Effort is one move away. */}
            {models.length === 0 && (
              <DropdownMenuItem disabled>
                No models available. Check Connected accounts in Settings.
              </DropdownMenuItem>
            )}
            {models.map((item) => (
              <DropdownMenuRadioItem
                key={modelKey(item)}
                value={modelKey(item)}
                disabled={disabledProviders.includes(item.provider)}
                closeOnClick={false}
              >
                <ProviderGlyph provider={item.provider} className='size-3' />
                <ModelLabel model={item} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub
        defaultOpen={submenu === 'effort' && efforts.length > 0}
        closeParentOnEsc={submenu === 'effort'}
      >
        <DisabledTooltip
          reason={
            efforts.length > 0
              ? undefined
              : value
                ? `${name} doesn’t support effort levels`
                : 'Choose a model first'
          }
          side='right'
        >
          <DropdownMenuSubTrigger className={subTriggerClass} disabled={efforts.length === 0}>
            Effort
            <span className='ml-auto pl-4 text-muted-foreground'>
              {value?.effort && effortLabels[value.effort]}
            </span>
            {keybindChips && <KeybindChip binding={keybinds.effort} />}
          </DropdownMenuSubTrigger>
        </DisabledTooltip>
        <DropdownMenuSubContent ref={submenu === 'effort' ? submenuRef : undefined}>
          <DropdownMenuRadioGroup
            value={value?.effort ?? ''}
            onValueChange={(next) => {
              const effort = efforts.find((level) => level === next)
              if (value && effort) onChange({ ...value, effort })
            }}
          >
            {efforts.map((effort) => (
              <DropdownMenuRadioItem key={effort} value={effort}>
                {effortLabels[effort]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DisabledTooltip
        reason={
          value && model?.fast
            ? undefined
            : value
              ? `${name} doesn’t support Fast`
              : 'Choose a model first'
        }
        side='right'
      >
        <DropdownMenuCheckboxItem
          className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
          disabled={!value || !model?.fast}
          checked={value?.fast ?? false}
          closeOnClick={false}
          onCheckedChange={(fast) => value && onChange({ ...value, fast })}
        >
          Fast
          <Switch
            render={<span />}
            size='sm'
            checked={value?.fast ?? false}
            tabIndex={-1}
            aria-hidden='true'
            className='pointer-events-none ml-auto'
          />
        </DropdownMenuCheckboxItem>
      </DisabledTooltip>
    </DropdownMenuGroup>
  )
}

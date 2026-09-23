import type { ProviderId, ProviderModel } from '@jetty/shared/wire'
import type { SyntheticEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import {
  describeLoadout,
  effortLabels,
  equipModel,
  findModel,
  modelKey,
  sameLoadout,
  slotLoadout,
  type Loadout,
  type LoadoutSlot,
} from '@/lib/loadout'
import { PointerSensor, PointerActivationConstraints } from '@dnd-kit/dom'
import { RestrictToElement } from '@dnd-kit/dom/modifiers'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable, isSortable } from '@dnd-kit/react/sortable'
import { ArrowUpRightIcon, DotsSixVerticalIcon, PlusIcon } from '@phosphor-icons/react'
import { useReducedMotion } from 'motion/react'

import { ProviderGlyph } from './provider_glyph'

const subTriggerClass = 'gap-1 [&>svg:last-child]:ml-0 [&>svg:last-child]:text-muted-foreground'
const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
]
const modifiers = [
  RestrictToElement.configure({
    element: (operation) => operation.source?.element?.closest('[role="group"]') ?? null,
  }),
]

function stopSelect(event: SyntheticEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function SortableLoadoutItem({
  id,
  index,
  name,
  details,
  provider,
  disabled,
  onMove,
  onOpenSettings,
}: {
  id: string
  index: number
  name: string
  details: string
  provider: ProviderId
  disabled: boolean
  onMove: (from: number, to: number) => void
  onOpenSettings: () => void
}) {
  const reducedMotion = useReducedMotion()
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    transition: reducedMotion ? null : { duration: 150, easing: 'ease-out' },
  })
  return (
    <DropdownMenuRadioItem
      ref={ref}
      value={id}
      disabled={disabled}
      closeOnClick
      className='group/loadout h-8! gap-0 pl-1.5 pr-1.5 data-checked:bg-accent [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden'
      title='Drag to reorder · Option+Shift+↑/↓'
      aria-keyshortcuts='Alt+Shift+ArrowUp Alt+Shift+ArrowDown'
      onKeyDown={(event) => {
        if (!event.altKey || !event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key))
          return
        event.preventDefault()
        event.stopPropagation()
        onMove(index, index + (event.key === 'ArrowUp' ? -1 : 1))
      }}
    >
      <span
        ref={handleRef}
        aria-hidden='true'
        tabIndex={-1}
        className={`-my-0.5 -ml-1.5 flex h-8 w-7 touch-none items-center justify-center ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onClick={stopSelect}
        onPointerUp={stopSelect}
      >
        <DotsSixVerticalIcon className='size-4! text-muted-foreground' />
      </span>
      <span className='flex items-center gap-1.5'>
        <ProviderGlyph
          provider={provider}
          className='size-3 text-muted-foreground group-data-checked/loadout:text-foreground'
        />
        {name}
        <span className='text-muted-foreground'>{details}</span>
      </span>
      <button
        type='button'
        tabIndex={-1}
        aria-label='Open loadout settings'
        className='ml-auto flex size-5 items-center justify-center rounded-menu-item text-muted-foreground hover:text-foreground'
        onClick={(event) => {
          stopSelect(event)
          onOpenSettings()
        }}
        onPointerUp={stopSelect}
      >
        <ArrowUpRightIcon className='size-3.5' />
      </button>
    </DropdownMenuRadioItem>
  )
}

function EmptyLoadoutRows({
  slots,
  onOpenSettings,
}: {
  slots: readonly number[]
  onOpenSettings: () => void
}) {
  if (slots.length === 0) return null
  return (
    <div className='mt-0.5 flex flex-col gap-0.5'>
      {slots.map((slot) => (
        <DropdownMenuItem
          key={slot}
          onClick={onOpenSettings}
          aria-label={`Add configuration to slot ${slot}`}
          className='flex h-8! w-full items-center gap-1.5 rounded-menu-item pl-7 pr-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground outline-none'
        >
          <PlusIcon className='size-3 shrink-0' />
          <span>Add configuration</span>
          <span className='ml-auto flex size-5 shrink-0 items-center justify-center'>
            <ArrowUpRightIcon className='size-3.5' />
          </span>
        </DropdownMenuItem>
      ))}
    </div>
  )
}

export function ComposerLoadout({
  catalog,
  loadouts,
  value,
  lockedProvider,
  onChange,
  onReorder,
  onOpenSettings,
}: {
  catalog: readonly ProviderModel[]
  loadouts: readonly LoadoutSlot[]
  value: Loadout
  lockedProvider?: ProviderId
  onChange: (loadout: Loadout) => void
  onReorder: (loadouts: LoadoutSlot[]) => void
  onOpenSettings: () => void
}) {
  const model = findModel(catalog, value)
  const name = model?.name ?? value.model
  const equipped = loadouts.flatMap((slot) => {
    const loadout = slotLoadout(slot)
    return loadout ? [{ slot, loadout }] : []
  })
  const empty = loadouts.flatMap((slot, index) => (slot.model === null ? [index + 1] : []))
  const checked = equipped.find(({ loadout }) => sameLoadout(loadout, value))?.slot.id ?? ''
  const models = lockedProvider
    ? catalog.filter((item) => item.provider === lockedProvider)
    : catalog

  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= equipped.length) return
    const next = equipped.map(({ slot }) => slot)
    next.splice(to, 0, ...next.splice(from, 1))
    let equippedIndex = 0
    onReorder(loadouts.map((slot) => (slot.model === null ? slot : next[equippedIndex++]!)))
  }

  function swapModel(key: string) {
    const next = models.find((item) => modelKey(item) === key)
    if (!next) return
    const { provider, model: id, effort, fast } = equipModel(value, next)
    onChange({ provider, model: id, effort, fast })
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Loadout: ${name}, ${describeLoadout(value)}`}
        render={
          <Button
            variant='ghost'
            size='sm'
            className='group/chip gap-1.5 rounded-sm text-primary enabled:hover:text-primary aria-expanded:text-primary'
          />
        }
      >
        <ProviderGlyph provider={value.provider} className='size-3' />
        {name}
        <span className='text-muted-foreground group-hover/chip:text-foreground group-aria-expanded/chip:text-foreground'>
          {describeLoadout(value)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-max min-w-56'>
        <DropdownMenuGroup>
          <DragDropProvider
            sensors={sensors}
            modifiers={modifiers}
            onDragEnd={(event) => {
              if (event.canceled) return
              const { source } = event.operation
              if (isSortable(source)) reorder(source.initialIndex, source.index)
            }}
          >
            <DropdownMenuRadioGroup
              value={checked}
              onValueChange={(id) => {
                const picked = equipped.find(({ slot }) => slot.id === id)
                if (picked) onChange(picked.loadout)
              }}
              className='flex flex-col gap-0.5'
            >
              {equipped.map(({ slot, loadout }, index) => (
                <SortableLoadoutItem
                  key={slot.id}
                  id={slot.id}
                  index={index}
                  name={findModel(catalog, loadout)?.name ?? loadout.model}
                  details={describeLoadout(loadout)}
                  provider={loadout.provider}
                  disabled={Boolean(lockedProvider && lockedProvider !== loadout.provider)}
                  onMove={reorder}
                  onOpenSettings={onOpenSettings}
                />
              ))}
            </DropdownMenuRadioGroup>
          </DragDropProvider>
          <EmptyLoadoutRows slots={empty} onOpenSettings={onOpenSettings} />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={subTriggerClass}>
              Model
              <span className='ml-auto pl-4 text-muted-foreground'>{name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={modelKey({ provider: value.provider, id: value.model })}
                onValueChange={(key) => swapModel(String(key))}
              >
                {models.map((item) => (
                  <DropdownMenuRadioItem key={modelKey(item)} value={modelKey(item)}>
                    <ProviderGlyph provider={item.provider} className='size-3' />
                    {item.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {model && model.efforts.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={subTriggerClass}>
                Effort
                <span className='ml-auto pl-4 text-muted-foreground'>
                  {value.effort && effortLabels[value.effort]}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={value.effort ?? ''}
                  onValueChange={(next) => {
                    const effort = model.efforts.find((level) => level === next)
                    if (effort) onChange({ ...value, effort })
                  }}
                >
                  {model.efforts.map((effort) => (
                    <DropdownMenuRadioItem key={effort} value={effort}>
                      {effortLabels[effort]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {model?.fast && (
            <DropdownMenuCheckboxItem
              className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
              checked={value.fast}
              closeOnClick={false}
              onCheckedChange={(fast) => onChange({ ...value, fast })}
            >
              Fast
              <Switch
                render={<span />}
                size='sm'
                checked={value.fast}
                tabIndex={-1}
                aria-hidden='true'
                className='pointer-events-none ml-auto'
              />
            </DropdownMenuCheckboxItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

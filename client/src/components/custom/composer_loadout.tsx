import type { ProviderId, ProviderModel } from '@jetty/shared/wire'
import type { KeyboardEvent, SyntheticEvent } from 'react'

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
import { cn } from '@/lib/utils'
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

function moveOnKeys(index: number, onMove: (from: number, to: number) => void) {
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
      <DotsSixVerticalIcon className='size-4! text-muted-foreground' />
    </span>
  )
}

function SettingsArrow({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <button
      type='button'
      tabIndex={-1}
      aria-label='Open loadout settings'
      className='ml-auto flex size-5 shrink-0 items-center justify-center rounded-menu-item text-muted-foreground hover:text-foreground'
      onClick={(event) => {
        stopSelect(event)
        onOpenSettings()
      }}
      onPointerUp={stopSelect}
    >
      <ArrowUpRightIcon className='size-3.5' />
    </button>
  )
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
      onKeyDown={moveOnKeys(index, onMove)}
    >
      <DragHandle handleRef={handleRef} isDragging={isDragging} />
      <span className='flex items-center gap-1.5'>
        <ProviderGlyph
          provider={provider}
          className='size-3 text-muted-foreground group-data-checked/loadout:text-foreground'
        />
        {name}
        <span className='text-muted-foreground'>{details}</span>
      </span>
      <SettingsArrow onOpenSettings={onOpenSettings} />
    </DropdownMenuRadioItem>
  )
}

const emptyRowClass =
  'flex h-8! w-full items-center gap-1.5 rounded-menu-item pr-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground outline-none'

function EmptyRowLabel() {
  return (
    <span className='flex items-center gap-1.5'>
      <PlusIcon className='size-3 shrink-0' />
      Add configuration
    </span>
  )
}

function EmptyLoadoutRow({ slot, onOpenSettings }: { slot: number; onOpenSettings: () => void }) {
  return (
    <DropdownMenuItem
      onClick={onOpenSettings}
      aria-label={`Add configuration to slot ${slot}`}
      className={`${emptyRowClass} pl-2`}
    >
      <EmptyRowLabel />
      <SettingsArrow onOpenSettings={onOpenSettings} />
    </DropdownMenuItem>
  )
}

function SortableEmptyRow({
  id,
  index,
  onMove,
  onOpenSettings,
}: {
  id: string
  index: number
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
    <DropdownMenuItem
      ref={ref}
      onClick={onOpenSettings}
      aria-label={`Add configuration to slot ${index + 1}`}
      title='Drag to reorder · Option+Shift+↑/↓'
      aria-keyshortcuts='Alt+Shift+ArrowUp Alt+Shift+ArrowDown'
      onKeyDown={moveOnKeys(index, onMove)}
      className={`${emptyRowClass} gap-0 pl-1.5`}
    >
      <DragHandle handleRef={handleRef} isDragging={isDragging} />
      <EmptyRowLabel />
      <SettingsArrow onOpenSettings={onOpenSettings} />
    </DropdownMenuItem>
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
  value?: Loadout
  lockedProvider?: ProviderId
  onChange: (loadout: Loadout) => void
  onReorder: (loadouts: LoadoutSlot[]) => void
  onOpenSettings: () => void
}) {
  const model = value && findModel(catalog, value)
  const name = model?.name ?? value?.model
  const equipped = loadouts.flatMap((slot) => {
    const loadout = slotLoadout(slot)
    return loadout ? [{ slot, loadout }] : []
  })
  const checked =
    (value && equipped.find(({ loadout }) => sameLoadout(loadout, value))?.slot.id) ?? ''
  const models = lockedProvider
    ? catalog.filter((item) => item.provider === lockedProvider)
    : catalog

  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= loadouts.length) return
    const next = [...loadouts]
    next.splice(to, 0, ...next.splice(from, 1))
    onReorder(next)
  }

  function swapModel(key: string) {
    const next = models.find((item) => modelKey(item) === key)
    if (!next) return
    const { provider, model: id, effort, fast } = equipModel(value ?? { fast: false }, next)
    onChange({ provider, model: id, effort, fast })
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={value ? `Loadout: ${name}, ${describeLoadout(value)}` : 'Choose a model'}
        render={
          <Button
            variant='ghost'
            size='sm'
            tone={value ? 'default' : 'muted'}
            className={cn(
              'group/chip gap-1.5 rounded-sm',
              value && 'text-primary enabled:hover:text-primary aria-expanded:text-primary'
            )}
          />
        }
      >
        {value ? (
          <>
            <ProviderGlyph provider={value.provider} className='size-3' />
            {name}
            <span className='text-muted-foreground group-hover/chip:text-foreground group-aria-expanded/chip:text-foreground'>
              {describeLoadout(value)}
            </span>
          </>
        ) : (
          'Choose a model'
        )}
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
              {loadouts.map((slot, index) => {
                const loadout = slotLoadout(slot)
                if (equipped.length === 0)
                  return (
                    <EmptyLoadoutRow
                      key={slot.id}
                      slot={index + 1}
                      onOpenSettings={onOpenSettings}
                    />
                  )
                if (!loadout)
                  return (
                    <SortableEmptyRow
                      key={slot.id}
                      id={slot.id}
                      index={index}
                      onMove={reorder}
                      onOpenSettings={onOpenSettings}
                    />
                  )
                return (
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
                )
              })}
            </DropdownMenuRadioGroup>
          </DragDropProvider>
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
                value={value ? modelKey({ provider: value.provider, id: value.model }) : ''}
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
          {value && model && model.efforts.length > 0 && (
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
          {value && model?.fast && (
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

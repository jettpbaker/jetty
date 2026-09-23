import type { ProviderModel as LoadoutModel } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import {
  clearSlot,
  copilotModels,
  effortLabels,
  equipModel,
  findModel,
  modelKey,
  type LoadoutSlot as Slot,
} from '@/lib/loadout'
import { useLoadouts } from '@/state'
import { KeyboardSensor, PointerSensor, PointerActivationConstraints } from '@dnd-kit/dom'
import { DragDropProvider, DragOverlay, useDraggable } from '@dnd-kit/react'
import { useSortable, isSortable } from '@dnd-kit/react/sortable'
import { ArrowUpRightIcon, DotsSixVerticalIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { ProviderEnabled, ProviderId } from './settings_providers'

import { moveOnKeys } from './composer_loadout'
import { LightningIcon } from './lightning_icon'
import { ProviderGlyph } from './provider_glyph'
import './settings_loadout.css'

type ClearedConfig = { slot: Slot; model: LoadoutModel; rect: DOMRect }
type EquipFlight = {
  slotId: string
  model: LoadoutModel
  row: DOMRect
  logo: DOMRect
  name: DOMRect
}
const equipSpring = { type: 'spring' as const, duration: 0.3, bounce: 0.12 }
const providers = [
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'grok', name: 'Grok' },
] as const
type ModelGroup = { provider: (typeof providers)[number]; models: LoadoutModel[] }
const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
  KeyboardSensor,
]

function Glyph({ provider, large = false }: { provider: string; large?: boolean }) {
  return <ProviderGlyph provider={provider} className={large ? 'size-7' : 'size-3'} />
}

function EffortSummary({ slot }: { slot: Slot }) {
  return (
    <span data-equip-effort className='flex items-center gap-1'>
      {slot.fast && <LightningIcon filled data-icon='inline-start' className='size-3!' />}
      {slot.effort && effortLabels[slot.effort]}
    </span>
  )
}

function ConfigContent({
  model,
  slot,
  hidden = false,
  trailing,
  children,
}: {
  model: LoadoutModel
  slot: Slot
  hidden?: boolean
  trailing?: ReactNode
  children?: ReactNode
}) {
  return (
    <>
      <div
        data-equip-logo
        style={{ visibility: hidden ? 'hidden' : undefined }}
        className='pointer-events-none relative flex min-h-0 items-center justify-center text-muted-foreground'
      >
        <span className='flex'>
          <Glyph provider={model.provider} large />
        </span>
      </div>
      <div
        data-equip-details
        style={{ visibility: hidden ? 'hidden' : undefined }}
        className='pointer-events-none relative flex min-w-0 flex-1 flex-col items-start'
      >
        <div className='flex w-full items-center justify-between gap-3'>
          <span data-equip-name className='text-xs font-medium'>
            {model.name}
          </span>
          {trailing}
        </div>
        {children ?? (
          <span className='flex h-7 items-center gap-1 text-xs text-muted-foreground'>
            <EffortSummary slot={slot} />
          </span>
        )}
      </div>
    </>
  )
}

function describe(slot: Slot) {
  return [slot.effort && effortLabels[slot.effort], slot.fast && 'Fast'].filter(Boolean).join(' · ')
}

export function SettingsLoadout({
  enabledProviders,
  onConnectProvider,
}: {
  enabledProviders: ProviderEnabled
  onConnectProvider: (id: ProviderId) => void
}) {
  const { loadouts: slots, catalog, setLoadouts } = useLoadouts()
  const [announcement, setAnnouncement] = useState('')
  const [catalogDragging, setCatalogDragging] = useState(false)
  const [replaced, setReplaced] = useState<Slot | null>(null)
  const [flight, setFlight] = useState<EquipFlight | null>(null)
  const [cleared, setCleared] = useState<ClearedConfig | null>(null)
  const rowPreviewRef = useRef<HTMLDivElement>(null)
  const reducedMotion = !!useReducedMotion()
  const groups = providers
    .filter((provider) => enabledProviders[provider.id])
    .map((provider) => ({
      provider,
      models: catalog.filter((model) => model.provider === provider.id),
    }))
    .filter((group) => group.models.length > 0)
  function save(next: Slot[], message: string) {
    try {
      setLoadouts(next)
      setAnnouncement(message)
    } catch {
      setAnnouncement(
        `${message} Changes are available for this visit; browser storage is unavailable.`
      )
    }
  }
  function equip(slot: Slot, model: LoadoutModel) {
    const next = equipModel(slot, model)
    const adjustments = [
      slot.model && next.effort !== slot.effort
        ? `Effort changed to ${next.effort ? effortLabels[next.effort] : 'none'}.`
        : '',
      slot.fast && !next.fast ? 'Fast is unavailable for this model and was turned off.' : '',
    ]
      .filter(Boolean)
      .join(' ')
    save(
      slots.map((item) => (item.id === slot.id ? next : item)),
      `${model.name} equipped in slot ${slots.indexOf(slot) + 1}. ${adjustments}`
    )
  }
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= slots.length) return
    const next = [...slots]
    next.splice(to, 0, ...next.splice(from, 1))
    save(next, 'Configuration reordered.')
  }
  return (
    <div className='settings-loadout'>
      <DragDropProvider
        sensors={sensors}
        onDragStart={(event) => {
          setFlight(null)
          setCleared(null)
          setReplaced(null)
          setCatalogDragging(!isSortable(event.operation.source))
        }}
        onDragEnd={(event) => {
          setCatalogDragging(false)
          const { source, target } = event.operation
          if (event.canceled || !source) return
          if (isSortable(source)) {
            if (!target) save(clearSlot(slots, String(source.id)), 'Slot cleared.')
            else move(source.initialIndex, source.index)
            return
          }
          const slot = slots.find((item) => item.id === target?.id)
          const model = catalog.find((item) => modelKey(item) === String(source.id))
          if (!slot || !model) return
          if (slot.model) {
            setReplaced(slot)
          } else {
            const preview = rowPreviewRef.current
            const logo = preview?.querySelector('[data-preview-logo]')
            const name = preview?.querySelector('[data-model-name]')
            if (preview && logo && name)
              setFlight({
                slotId: slot.id,
                model,
                row: preview.getBoundingClientRect(),
                logo: logo.getBoundingClientRect(),
                name: name.getBoundingClientRect(),
              })
          }
          equip(slot, model)
        }}
      >
        <div className='flex flex-col' role='group' aria-label='Vertical model loadout slots'>
          {slots.map((slot, index) => (
            <LoadoutSlot
              key={slot.id}
              slot={slot}
              index={index}
              catalog={catalog}
              groups={groups}
              onEquip={(key) => {
                const picked = catalog.find((item) => modelKey(item) === key)
                if (picked) equip(slot, picked)
              }}
              onMove={move}
              clearing={cleared?.slot.id === slot.id}
              onClear={(config) => {
                setCleared(config)
                save(clearSlot(slots, slot.id), 'Slot cleared.')
              }}
              previous={replaced?.id === slot.id ? replaced : undefined}
              onReplaceComplete={() => setReplaced(null)}
              flight={flight?.slotId === slot.id ? flight : null}
              onFlightComplete={() => setFlight(null)}
              catalogDragging={catalogDragging}
              reducedMotion={reducedMotion}
              onChange={(next) =>
                save(
                  slots.map((item) => (item.id === slot.id ? next : item)),
                  `Slot ${index + 1} saved: ${describe(next)}.`
                )
              }
            />
          ))}
        </div>
        <div
          className='loadout-catalog scrollbar-subtle'
          role='region'
          aria-label='Available models'
          tabIndex={0}
        >
          {providers.map((provider) => (
            <div
              key={provider.id}
              className='flex min-w-0 flex-col gap-2'
              role='group'
              aria-label={`${provider.name} models`}
            >
              <h3
                className={`flex items-center gap-2 px-2 text-13 [&>.provider-icon]:size-3.5 ${enabledProviders[provider.id] ? 'text-muted-foreground' : 'text-disabled-foreground'}`}
              >
                <Glyph provider={provider.id} />
                {provider.name}
              </h3>
              <div className='flex flex-col gap-1'>
                {catalog
                  .filter((model) => model.provider === provider.id)
                  .map((model) => (
                    <CatalogModel
                      key={modelKey(model)}
                      model={model}
                      disabled={!enabledProviders[model.provider]}
                    />
                  ))}
              </div>
            </div>
          ))}
          <div
            className='flex min-w-0 flex-col gap-2'
            role='group'
            aria-label='GitHub Copilot models — provider disabled'
          >
            <div className='flex items-center justify-between gap-2 px-2'>
              <h3 className='flex items-center gap-2 text-13 text-disabled-foreground [&>.provider-icon]:size-3.5'>
                <Glyph provider='copilot' />
                Copilot
              </h3>
              <button
                type='button'
                onClick={() => onConnectProvider('copilot')}
                aria-label='Connect GitHub Copilot'
                className='inline-flex shrink-0 items-center gap-1 rounded-menu-item text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'
              >
                Connect
                <ArrowUpRightIcon aria-hidden='true' className='size-3' />
              </button>
            </div>
            <div className='flex flex-col gap-1'>
              {copilotModels.map((name) => (
                <button
                  key={name}
                  type='button'
                  disabled
                  className='flex h-7 w-full min-w-0 cursor-not-allowed items-center rounded-menu-item text-left text-xs text-disabled-foreground'
                  aria-label={`${name} — GitHub Copilot disabled`}
                >
                  <span className='flex w-6 shrink-0 items-center justify-center'>
                    <DotsSixVerticalIcon aria-hidden='true' className='size-3.5' />
                  </span>
                  <span className='truncate px-1'>{name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {(source) => {
              const model = catalog.find((item) => modelKey(item) === String(source.id))
              if (!model) return null
              return (
                <div
                  ref={rowPreviewRef}
                  className='flex items-center gap-2 rounded-menu-item border border-border bg-popover px-3 py-2 text-xs text-foreground shadow-md'
                >
                  <span data-preview-logo className='flex text-muted-foreground'>
                    <Glyph provider={model.provider} />
                  </span>
                  <span data-model-name>{model.name}</span>
                </div>
              )
            }}
          </DragOverlay>,
          document.body
        )}
      </DragDropProvider>
      {cleared &&
        createPortal(
          <motion.div
            aria-hidden='true'
            className='loadout-ghost pointer-events-none fixed z-[100] flex text-foreground'
            style={{
              left: cleared.rect.x,
              top: cleared.rect.y,
              width: cleared.rect.width,
              height: cleared.rect.height,
            }}
            initial={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            animate={{
              opacity: 0,
              scale: reducedMotion ? 1 : 0.9,
              filter: reducedMotion ? 'blur(0px)' : 'blur(12px)',
            }}
            transition={{ duration: 0.2, ease: 'easeIn' }}
            onAnimationComplete={() => setCleared(null)}
          >
            <ConfigContent model={cleared.model} slot={cleared.slot} />
          </motion.div>,
          document.body
        )}
      <p role='status' aria-live='polite' className='sr-only'>
        {announcement}
      </p>
    </div>
  )
}

function LoadoutSlot({
  slot,
  index,
  catalog,
  groups,
  onEquip,
  onMove,
  clearing,
  onClear,
  previous,
  onReplaceComplete,
  reducedMotion,
  flight,
  onFlightComplete,
  catalogDragging,
  onChange,
}: {
  slot: Slot
  index: number
  catalog: readonly LoadoutModel[]
  groups: readonly ModelGroup[]
  onEquip: (key: string) => void
  onMove: (from: number, to: number) => void
  clearing: boolean
  onClear: (config: ClearedConfig) => void
  previous?: Slot
  onReplaceComplete: () => void
  reducedMotion: boolean
  flight: EquipFlight | null
  onFlightComplete: () => void
  catalogDragging: boolean
  onChange: (slot: Slot) => void
}) {
  const model = findModel(catalog, slot)
  const previousModel = previous && findModel(catalog, previous)
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: slot.id,
    index,
    group: 'loadout',
    disabled: { draggable: !model },
    transition: reducedMotion ? null : { duration: 150, easing: 'ease-out' },
  })
  const slotRef = useRef<HTMLDivElement>(null)
  const picked = useRef(false)
  useLayoutEffect(() => {
    if (!model || !picked.current) return
    picked.current = false
    slotRef.current?.querySelector('button')?.focus()
  }, [model])
  return (
    <div
      ref={ref}
      className='loadout-slot-target'
      data-dragging={isDragging || undefined}
      data-drop-target={isDropTarget || undefined}
      data-replacing={(catalogDragging && isDropTarget && !!model) || undefined}
    >
      <motion.div
        key={previous ? `replacement:${slot.model}` : 'settled'}
        initial={
          previous
            ? {
                opacity: 0,
                filter: reducedMotion ? 'blur(0px)' : 'blur(4px)',
                transform: reducedMotion ? 'scale(1)' : 'scale(1.03)',
              }
            : false
        }
        animate={{ opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }}
        transition={{
          delay: previous ? 0.08 : 0,
          duration: previous ? 0.2 : 0,
          ease: [0.25, 1, 0.5, 1],
        }}
        onAnimationComplete={() => {
          if (previous) onReplaceComplete()
        }}
        ref={slotRef}
        className={`loadout-slot group/slot relative flex min-w-0 ${!model ? 'loadout-slot-empty' : ''}`}
        role='group'
        aria-label={`Slot ${index + 1}: ${model ? [model.name, describe(slot)].filter(Boolean).join(', ') : 'Empty'}`}
      >
        {!model ? (
          <ModelPicker
            groups={groups}
            onPick={(key) => {
              picked.current = true
              onEquip(key)
            }}
            label={`Choose a model for slot ${index + 1}`}
            render={
              <button
                type='button'
                className='absolute inset-0 flex rounded-menu-item focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'
              />
            }
          >
            {/* Without a handle, dnd-kit would mark the whole slot a disabled button. */}
            <motion.div
              ref={handleRef}
              aria-hidden='true'
              tabIndex={-1}
              initial={clearing ? { opacity: 0 } : false}
              animate={{ opacity: catalogDragging && isDropTarget ? 0 : 1 }}
              transition={{ duration: 0.12 }}
              className='flex flex-1 items-center justify-center gap-2 text-muted-foreground'
            >
              <PlusIcon aria-hidden='true' className='size-5' />
              <span className='text-xs'>Drop a model</span>
            </motion.div>
          </ModelPicker>
        ) : (
          <>
            <button
              ref={handleRef}
              type='button'
              aria-label={`Drag ${model.name} configuration from slot ${index + 1}`}
              title='Drag to reorder · Option+Shift+↑/↓'
              aria-keyshortcuts='Alt+Shift+ArrowUp Alt+Shift+ArrowDown'
              onKeyDown={moveOnKeys(index, onMove)}
              className='absolute inset-0 touch-none cursor-grab rounded-menu-item focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 active:cursor-grabbing'
            />
            <button
              type='button'
              aria-label={`Clear slot ${index + 1}: ${model.name}`}
              className='loadout-clear absolute right-1 top-1 z-10 flex size-6 items-center justify-center rounded-menu-item text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/slot:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring'
              onClick={(event) =>
                onClear({
                  slot,
                  model,
                  rect: event.currentTarget.closest('.loadout-slot')!.getBoundingClientRect(),
                })
              }
            >
              <XIcon aria-hidden='true' className='size-3' />
            </button>
            <ConfigContent
              model={model}
              slot={slot}
              hidden={!!flight}
              trailing={
                index === 0 ? (
                  <span className='shrink-0 pr-6 text-xs text-muted-foreground'>Default</span>
                ) : undefined
              }
            >
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  aria-label={[`Configure slot ${index + 1}`, describe(slot)]
                    .filter(Boolean)
                    .join(': ')}
                  render={
                    <Button
                      variant='ghost'
                      tone='muted'
                      size='sm'
                      className='pointer-events-auto -ml-2 h-7 gap-1 rounded-menu-item px-2 text-xs'
                    />
                  }
                >
                  <EffortSummary slot={slot} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='min-w-40'>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Effort</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={slot.effort}
                      onValueChange={(value) =>
                        onChange({
                          ...slot,
                          effort: model.efforts.find((effort) => effort === value),
                        })
                      }
                    >
                      {model.efforts.map((effort) => (
                        <DropdownMenuRadioItem key={effort} value={effort}>
                          {effortLabels[effort]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  {model.fast && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
                        checked={slot.fast}
                        closeOnClick={false}
                        onCheckedChange={(fast) => onChange({ ...slot, fast })}
                      >
                        <LightningIcon filled={slot.fast} className='text-muted-foreground' />
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
                </DropdownMenuContent>
              </DropdownMenu>
            </ConfigContent>
          </>
        )}
        {flight && (
          <EquipAnimation
            flight={flight}
            slot={slot}
            reducedMotion={reducedMotion}
            onComplete={onFlightComplete}
          />
        )}
      </motion.div>
      {previous && previousModel && (
        <motion.div
          key={`${previous.model}:${previous.effort}:${previous.fast}`}
          aria-hidden='true'
          className='loadout-ghost pointer-events-none absolute inset-0 z-10 flex'
          initial={{ transform: 'scale(1)', opacity: 0.5, filter: 'blur(0px)' }}
          animate={{
            opacity: 0,
            transform: reducedMotion ? 'scale(1)' : 'scale(0.97)',
            filter: reducedMotion ? 'blur(0px)' : 'blur(4px)',
          }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <ConfigContent model={previousModel} slot={previous} />
        </motion.div>
      )}
    </div>
  )
}

// Animate independent layers so text and logos never stretch.
function EquipAnimation({
  flight,
  slot,
  reducedMotion,
  onComplete,
}: {
  flight: EquipFlight
  slot: Slot
  reducedMotion: boolean
  onComplete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [destination, setDestination] = useState<{
    card: DOMRect
    logo: DOMRect
    name: DOMRect
    effort: DOMRect
    effortWeight: string
    effortLineHeight: string
  } | null>(null)
  useLayoutEffect(() => {
    const card = ref.current?.parentElement
    const logo = card?.querySelector('[data-equip-logo] > span')
    const name = card?.querySelector('[data-equip-name]')
    const effort = card?.querySelector('[data-equip-effort]')
    if (card && logo && name && effort)
      setDestination({
        card: card.getBoundingClientRect(),
        logo: logo.getBoundingClientRect(),
        name: name.getBoundingClientRect(),
        effort: effort.getBoundingClientRect(),
        effortWeight: getComputedStyle(effort).fontWeight,
        effortLineHeight: getComputedStyle(effort).lineHeight,
      })
  }, [])
  const transition = reducedMotion ? { duration: 0.12 } : equipSpring
  return (
    <div ref={ref} aria-hidden='true' className='pointer-events-none absolute inset-0 z-10'>
      {destination && (
        <>
          <motion.div
            className='absolute border border-border bg-background'
            style={{
              left: 0,
              top: 0,
              width: destination.card.width,
              height: destination.card.height,
              transformOrigin: '0 0',
              borderRadius: 4,
            }}
            initial={
              reducedMotion
                ? { opacity: 0 }
                : {
                    x: flight.row.x - destination.card.x,
                    y: flight.row.y - destination.card.y,
                    scaleX: flight.row.width / destination.card.width,
                    scaleY: flight.row.height / destination.card.height,
                  }
            }
            animate={{
              x: 0,
              y: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
              borderRadius: 0,
              borderColor: 'transparent',
            }}
            transition={transition}
          />
          <motion.div
            className='absolute flex'
            style={{
              left: destination.logo.x - destination.card.x,
              top: destination.logo.y - destination.card.y,
              transformOrigin: '0 0',
            }}
            initial={
              reducedMotion
                ? { color: 'var(--muted-foreground)', opacity: 0 }
                : {
                    x: flight.logo.x - destination.logo.x,
                    y: flight.logo.y - destination.logo.y,
                    scale: flight.logo.width / destination.logo.width,
                    color: 'var(--muted-foreground)',
                  }
            }
            animate={{ x: 0, y: 0, scale: 1, opacity: 1, color: 'var(--muted-foreground)' }}
            transition={{ ...transition, color: { delay: 0.18, duration: 0.12 } }}
          >
            <Glyph provider={flight.model.provider} large />
          </motion.div>
          <motion.span
            className='absolute whitespace-nowrap text-xs font-medium'
            style={{
              left: destination.name.x - destination.card.x,
              top: destination.name.y - destination.card.y,
            }}
            initial={
              reducedMotion
                ? { opacity: 0 }
                : { x: flight.name.x - destination.name.x, y: flight.name.y - destination.name.y }
            }
            animate={{ x: 0, y: 0, opacity: 1 }}
            transition={transition}
          >
            {flight.model.name}
          </motion.span>
          <motion.span
            className='absolute flex items-center text-xs text-muted-foreground'
            style={{
              left: destination.effort.x - destination.card.x,
              top: destination.effort.y - destination.card.y,
              height: destination.effort.height,
              fontWeight: destination.effortWeight,
              lineHeight: destination.effortLineHeight,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              delay: reducedMotion ? 0 : 0.08,
              duration: reducedMotion ? 0.12 : 0.22,
              ease: 'easeOut',
            }}
            onAnimationComplete={onComplete}
          >
            <EffortSummary slot={slot} />
          </motion.span>
        </>
      )}
    </div>
  )
}

function ModelPicker({
  groups,
  onPick,
  label,
  render,
  children,
}: {
  groups: readonly ModelGroup[]
  onPick: (key: string) => void
  label: string
  render: ReactElement
  children: ReactNode
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger aria-label={label} render={render}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-48'>
        {groups.map(({ provider, models }, index) => (
          <DropdownMenuGroup key={provider.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className='flex items-center gap-2 [&>.provider-icon]:size-3'>
              <Glyph provider={provider.id} />
              {provider.name}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value='' onValueChange={(value) => onPick(String(value))}>
              {models.map((model) => (
                <DropdownMenuRadioItem key={modelKey(model)} value={modelKey(model)}>
                  {model.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CatalogModel({ model, disabled = false }: { model: LoadoutModel; disabled?: boolean }) {
  const { ref, handleRef, isDragging } = useDraggable({ id: modelKey(model), disabled })
  return (
    <div ref={ref} className='min-w-0' style={{ opacity: isDragging ? 0.4 : 1 }}>
      <button
        ref={handleRef}
        type='button'
        disabled={disabled}
        aria-label={`Drag ${model.name}`}
        className='flex h-7 w-full min-w-0 touch-none cursor-grab items-center rounded-menu-item text-left text-xs enabled:hover:bg-accent disabled:cursor-not-allowed disabled:text-disabled-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing'
      >
        <span className='flex w-6 shrink-0 items-center justify-center text-muted-foreground'>
          <DotsSixVerticalIcon aria-hidden='true' className='size-3.5' />
        </span>
        <span className='truncate px-1'>{model.name}</span>
      </button>
    </div>
  )
}

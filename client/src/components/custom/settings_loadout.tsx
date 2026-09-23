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
import { providerLogoPath } from '@/lib/provider-logo'
import { storage } from '@/platform'
import { KeyboardSensor, PointerSensor, PointerActivationConstraints } from '@dnd-kit/dom'
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react'
import { useSortable, isSortable } from '@dnd-kit/react/sortable'
import { ArrowUpRightIcon, DotsSixVerticalIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { ProviderEnabled, ProviderId } from './settings_providers'

import { LightningIcon } from './lightning_icon'
import {
  defaultLoadouts,
  dropConfig,
  effortLabels,
  equipModel,
  loadoutCatalog,
  restoreLoadouts,
  type Loadout,
  type LoadoutModel,
  type LoadoutSlot as Slot,
} from './settings_loadout_model'
import './settings_loadout.css'

type ClearedConfig = { slot: Slot; model: LoadoutModel; rect: DOMRect; fromDrag: boolean }
type EquipFlight = {
  slotId: string
  model: LoadoutModel
  row: DOMRect
  logo: DOMRect
  name: DOMRect
}
const equipSpring = { type: 'spring' as const, duration: 0.3, bounce: 0.12 }
const storageKey = 'jetty.loadout'
const providers = [
  { id: 'anthropic', name: 'Claude' },
  { id: 'openai', name: 'Codex' },
  { id: 'xai', name: 'Grok' },
] as const
// Curated preview from GitHub Docs: /en/copilot/reference/ai-models/supported-models
const copilotModels = ['GPT-6 Astra', 'Claude Sonnet 5', 'Gemini 3.8 Flash', 'Grok 4.6']
const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
  KeyboardSensor,
]
function Glyph({
  provider,
  large = false,
}: {
  provider: LoadoutModel['provider'] | 'copilot'
  large?: boolean
}) {
  return (
    <span
      aria-hidden='true'
      data-provider={provider}
      className={`provider-icon ${large ? 'size-7' : 'size-3'}`}
      style={{ maskImage: `url(${providerLogoPath(provider)})`, backgroundColor: 'currentColor' }}
    />
  )
}
function EffortSummary({ slot }: { slot: Slot }) {
  return (
    <span data-equip-effort className='flex items-center gap-1'>
      {slot.fast && <LightningIcon filled data-icon='inline-start' className='size-3!' />}
      {effortLabels[slot.effort]}
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
        className='pointer-events-none relative flex min-h-0 flex-1 items-center justify-center text-muted-foreground'
      >
        <span className='flex'>
          <Glyph provider={model.provider} large />
        </span>
      </div>
      <div
        data-equip-details
        style={{ visibility: hidden ? 'hidden' : undefined }}
        className='pointer-events-none relative flex min-w-0 flex-col items-start loadout-config-details'
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

function EmptySlotContent() {
  return (
    <>
      <PlusIcon aria-hidden='true' className='size-5' />
      <span className='text-xs'>Drop a model</span>
    </>
  )
}

function describe(slot: Slot) {
  return `${effortLabels[slot.effort]}${slot.fast ? ' · Fast' : ''}`
}
function load(key = storageKey) {
  try {
    return restoreLoadouts(JSON.parse(storage.get(key) ?? 'null'))
  } catch {
    return defaultLoadouts
  }
}

export function SettingsLoadout({
  enabledProviders,
  onConnectProvider,
  vertical = false,
}: {
  enabledProviders?: ProviderEnabled
  onConnectProvider?: (id: ProviderId) => void
  vertical?: boolean
}) {
  const key = vertical ? `${storageKey}.vertical` : storageKey
  const [slots, setSlots] = useState(() => load(key))
  const [announcement, setAnnouncement] = useState('')
  const [dragged, setDragged] = useState<string | null>(null)
  const [swap, setSwap] = useState<{
    sourceId: string
    previous: Slot[]
    replacement?: boolean
  } | null>(null)
  const [released, setReleased] = useState<ClearedConfig | null>(null)
  const [flight, setFlight] = useState<EquipFlight | null>(null)
  const [cleared, setCleared] = useState<ClearedConfig | null>(null)
  const configPreviewRef = useRef<HTMLDivElement>(null)
  const rowPreviewRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const bounds = useRef<Record<string, DOMRect>>({})
  const reducedMotion = useReducedMotion()
  const sourceSlot =
    dragged?.startsWith('config:') || dragged?.startsWith('vertical:')
      ? dragged.split(':')[1]
      : null
  function save(next: Slot[], message: string) {
    setSlots(next)
    try {
      storage.set(key, JSON.stringify(next))
      setAnnouncement(message)
    } catch {
      setAnnouncement(
        `${message} Changes are available for this visit; browser storage is unavailable.`
      )
    }
  }
  function clearSlot(slot: Slot, rect: DOMRect) {
    const model = loadoutCatalog.find((item) => item.id === slot.model)
    if (!model) return
    setCleared({ slot, model, rect, fromDrag: false })
    save(dropConfig(slots, slot.id, null), 'Slot cleared.')
  }
  function equip(slotId: string, modelId: string) {
    const model = loadoutCatalog.find((model) => model.id === modelId)
    const slot = slots.find((slot) => slot.id === slotId)
    if (!model || !slot) return
    const next = equipModel(slot, model)
    const adjustments = [
      slot.model && next.effort !== slot.effort
        ? `Effort changed to ${effortLabels[next.effort]}.`
        : '',
      slot.fast && !next.fast ? 'Fast is unavailable for this model and was turned off.' : '',
    ]
      .filter(Boolean)
      .join(' ')
    save(
      slots.map((item) => (item.id === slotId ? next : item)),
      `${model.name} equipped in slot ${slots.indexOf(slot) + 1}. ${adjustments}`
    )
  }
  return (
    <div className={`settings-loadout ${vertical ? 'loadout-v2' : 'flex flex-col gap-6'}`}>
      <DragDropProvider
        sensors={sensors}
        onDragStart={(event) => {
          setFlight(null)
          setReleased(null)
          setCleared(null)
          setSwap(null)
          bounds.current = Object.fromEntries(
            Array.from(gridRef.current?.children ?? []).flatMap((element, index) => {
              const slot = slots[index]
              return slot ? [[slot.id, element.getBoundingClientRect()] as const] : []
            })
          )
          setDragged(String(event.operation.source?.id ?? ''))
        }}
        onDragEnd={(event) => {
          setDragged(null)
          if (event.canceled) return
          const { source, target } = event.operation
          if (!source) return
          const sourceId = String(source.id)
          if (vertical && isSortable(source)) {
            if (target && source.initialIndex !== source.index) {
              const moved = slots[source.initialIndex]
              if (!moved) return
              const next = [...slots]
              next.splice(source.initialIndex, 1)
              next.splice(source.index, 0, moved)
              save(next, 'Configuration reordered.')
            } else if (!target) {
              save(
                dropConfig(slots, String(source.id).slice('vertical:'.length), null),
                'Slot cleared.'
              )
            }
            return
          }
          if (sourceId.startsWith('config:')) {
            const slotId = sourceId.slice('config:'.length)
            const targetId = target ? String(target.id) : null
            const next = dropConfig(slots, slotId, targetId)
            if (next === slots) return
            if (targetId === null && configPreviewRef.current) {
              const slot = slots.find((item) => item.id === slotId)
              const model = loadoutCatalog.find((item) => item.id === slot?.model)
              if (slot && model)
                setCleared({
                  slot,
                  model,
                  rect: configPreviewRef.current.getBoundingClientRect(),
                  fromDrag: true,
                })
            }
            const destination = slots.find((slot) => slot.id === targetId)
            if (destination) {
              setSwap({
                sourceId: slotId,
                previous: slots.filter((slot) => slot.id === slotId || slot.id === targetId),
              })
              const slot = slots.find((item) => item.id === slotId)
              const model = loadoutCatalog.find((item) => item.id === slot?.model)
              if (destination.model && slot && model && configPreviewRef.current) {
                setReleased({
                  slot,
                  model,
                  rect: configPreviewRef.current.getBoundingClientRect(),
                  fromDrag: true,
                })
              }
            }
            save(
              next,
              !destination
                ? 'Slot cleared.'
                : destination.model
                  ? 'Configurations swapped.'
                  : 'Configuration moved.'
            )
          } else if (target) {
            const slotId = String(target.id).replace(/^vertical:/, '')
            const model = loadoutCatalog.find((item) => item.id === sourceId)
            const preview = rowPreviewRef.current
            const logo = preview?.querySelector('[data-preview-logo]')
            const name = preview?.querySelector('[data-model-name]')
            if (
              model &&
              slots.find((slot) => slot.id === slotId)?.model === null &&
              preview &&
              logo &&
              name
            ) {
              setFlight({
                slotId,
                model,
                row: preview.getBoundingClientRect(),
                logo: logo.getBoundingClientRect(),
                name: name.getBoundingClientRect(),
              })
            }
            const occupied = slots.find((slot) => slot.id === slotId && slot.model !== null)
            if (model && occupied)
              setSwap({ sourceId: '', previous: [occupied], replacement: true })
            equip(slotId, sourceId)
          }
        }}
      >
        <div className='flex flex-col gap-2'>
          {!vertical && <span className='px-2 text-xs text-muted-foreground'>Default</span>}
          <div
            ref={gridRef}
            className='loadout-slots'
            role='group'
            aria-label={vertical ? 'Vertical model loadout slots' : 'Model loadout slots'}
          >
            {slots.map((slot, index) => (
              <LoadoutSlot
                key={slot.id}
                vertical={vertical}
                slot={slot}
                index={index}
                clearing={cleared?.slot.id === slot.id}
                onClear={(rect) => clearSlot(slot, rect)}
                previous={swap?.previous.find((item) => item.id === slot.id)}
                replacement={!!swap?.replacement}
                previousOpacity={swap?.replacement ? 0.5 : swap?.sourceId === slot.id ? 0.12 : 1}
                onSwapComplete={() => setSwap(null)}
                flight={flight?.slotId === slot.id ? flight : null}
                onFlightComplete={() => setFlight(null)}
                catalogDragging={dragged !== null && !sourceSlot}
                reducedMotion={!!reducedMotion}
                onChange={(next) =>
                  save(
                    slots.map((item) => (item.id === slot.id ? next : item)),
                    `Slot ${index + 1} saved: ${describe(next)}.`
                  )
                }
              />
            ))}
          </div>
        </div>
        <div
          className='loadout-catalog scrollbar-subtle'
          role={vertical ? 'region' : undefined}
          aria-label={vertical ? 'Available models' : undefined}
          tabIndex={vertical ? 0 : undefined}
        >
          {providers.map((provider) => (
            <div
              key={provider.id}
              className='flex min-w-0 flex-col gap-2'
              role='group'
              aria-label={`${provider.name} models`}
            >
              <h3
                className={`flex items-center gap-2 px-2 text-13 [&>.provider-icon]:size-3.5 ${enabledProviders?.[provider.id] === false ? 'text-disabled-foreground' : 'text-muted-foreground'}`}
              >
                <Glyph provider={provider.id} />
                {provider.name}
              </h3>
              <div className='flex flex-col gap-1'>
                {loadoutCatalog
                  .filter((model) => model.provider === provider.id)
                  .map((model) => (
                    <CatalogModel
                      key={model.id}
                      model={model}
                      disabled={enabledProviders?.[model.provider] === false}
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
                onClick={() => onConnectProvider?.('copilot')}
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
              if (vertical && String(source.id).startsWith('vertical:')) return null
              const config = slots.find((slot) => `config:${slot.id}` === source.id)
              const model = loadoutCatalog.find(
                (model) => model.id === (config ? config.model : source.id)
              )
              if (config && model)
                return (
                  <div
                    ref={configPreviewRef}
                    className='loadout-slot loadout-slot-overlay relative flex flex-col rounded-menu-item border border-border p-2 shadow-lg'
                    style={{
                      width: bounds.current[config.id]?.width,
                      height: bounds.current[config.id]?.height,
                    }}
                  >
                    <ConfigContent model={model} slot={config} />
                  </div>
                )
              return model ? (
                <div
                  ref={rowPreviewRef}
                  className='flex items-center gap-2 rounded-menu-item border border-border bg-popover px-3 py-2 text-xs text-foreground shadow-md'
                >
                  <span data-preview-logo className='flex text-muted-foreground'>
                    <Glyph provider={model.provider} />
                  </span>
                  <span data-model-name>{model.name}</span>
                  {config && (
                    <span className='flex items-center gap-1 text-muted-foreground'>
                      {config.fast && <LightningIcon filled className='size-3!' />}
                      {effortLabels[config.effort]}
                    </span>
                  )}
                </div>
              ) : null
            }}
          </DragOverlay>,
          document.body
        )}
      </DragDropProvider>
      {released &&
        createPortal(
          <motion.div
            aria-hidden='true'
            className='loadout-slot loadout-slot-overlay pointer-events-none fixed z-[100] flex flex-col rounded-menu-item border border-border p-2 text-foreground shadow-lg'
            style={{
              left: released.rect.x,
              top: released.rect.y,
              width: released.rect.width,
              height: released.rect.height,
            }}
            initial={{ opacity: 1, filter: 'blur(0px)' }}
            animate={{ opacity: 0, filter: reducedMotion ? 'blur(0px)' : 'blur(4px)' }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            onAnimationComplete={() => setReleased(null)}
          >
            <ConfigContent model={released.model} slot={released.slot} />
          </motion.div>,
          document.body
        )}
      {cleared &&
        createPortal(
          <motion.div
            aria-hidden='true'
            className={`loadout-slot ${vertical ? 'loadout-v2-ghost' : ''} pointer-events-none fixed z-[100] flex flex-col p-2 text-foreground ${cleared.fromDrag ? 'loadout-slot-overlay rounded-menu-item border border-border shadow-lg' : 'bg-transparent!'}`}
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
  vertical,
  slot,
  index,
  clearing,
  onClear,
  previous,
  replacement,
  previousOpacity,
  onSwapComplete,
  reducedMotion,
  flight,
  onFlightComplete,
  catalogDragging,
  onChange,
}: {
  vertical: boolean
  slot: Slot
  index: number
  clearing: boolean
  onClear: (rect: DOMRect) => void
  previous?: Slot
  replacement: boolean
  previousOpacity: number
  onSwapComplete: () => void
  reducedMotion: boolean
  flight: EquipFlight | null
  onFlightComplete: () => void
  catalogDragging: boolean
  onChange: (slot: Loadout) => void
}) {
  const model = loadoutCatalog.find((model) => model.id === slot.model)
  // Drop targets stay fixed throughout the drag and crossfade.
  const fixedDrop = useDroppable({ id: slot.id, disabled: vertical })
  const fixedDrag = useDraggable({ id: `config:${slot.id}`, disabled: vertical || !model })
  const sortable = useSortable({
    id: `vertical:${slot.id}`,
    index,
    group: 'vertical-loadout',
    disabled: vertical ? { draggable: !model } : true,
    transition: reducedMotion ? null : { duration: 150, easing: 'ease-out' },
  })
  const dropRef = vertical ? sortable.ref : fixedDrop.ref
  const dragRef = vertical ? undefined : fixedDrag.ref
  const handleRef = vertical ? sortable.handleRef : fixedDrag.handleRef
  const isDragging = vertical ? false : fixedDrag.isDragging
  const isDropTarget = vertical ? sortable.isDropTarget : fixedDrop.isDropTarget
  const previousModel = loadoutCatalog.find((item) => item.id === previous?.model)
  return (
    <div
      ref={dropRef}
      className='loadout-slot-target'
      data-vertical={vertical || undefined}
      data-dragging={(vertical && sortable.isDragging) || undefined}
      data-drop-target={isDropTarget || undefined}
      data-replacing={(catalogDragging && isDropTarget && !!model) || undefined}
    >
      <motion.div
        key={previous && replacement ? `replacement:${slot.model}` : 'settled'}
        ref={dragRef}
        initial={
          previous && replacement
            ? {
                opacity: 0,
                filter: reducedMotion ? 'blur(0px)' : 'blur(4px)',
                transform: reducedMotion ? 'scale(1)' : 'scale(1.03)',
              }
            : false
        }
        animate={{
          opacity: isDragging ? 0.12 : previous && !replacement ? [0, 1] : 1,
          filter:
            previous && !replacement && !reducedMotion ? ['blur(4px)', 'blur(0px)'] : 'blur(0px)',
          transform:
            previous && !replacement && !reducedMotion ? ['scale(0.96)', 'scale(1)'] : 'scale(1)',
        }}
        transition={{
          delay: previous && replacement ? 0.08 : 0,
          duration: previous ? (replacement ? 0.2 : 0.22) : 0,
          ease: [0.25, 1, 0.5, 1],
        }}
        onAnimationComplete={() => {
          if (previous) onSwapComplete()
        }}
        className={`loadout-slot group/slot relative flex min-w-0 flex-col p-2 ${!model ? 'loadout-slot-empty' : ''}`}
        role='group'
        aria-label={`Slot ${index + 1}: ${model ? `${model.name}, ${describe(slot)}` : 'Empty'}`}
      >
        {!model ? (
          <motion.div
            initial={clearing ? { opacity: 0 } : false}
            animate={{ opacity: catalogDragging && isDropTarget ? 0 : 1 }}
            transition={{ duration: 0.12 }}
            className='flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground'
          >
            <EmptySlotContent />
          </motion.div>
        ) : (
          <>
            <button
              ref={handleRef}
              type='button'
              aria-label={`Drag ${model.name} configuration from slot ${index + 1}`}
              className='absolute inset-0 touch-none cursor-grab rounded-menu-item focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 active:cursor-grabbing'
            />
            <button
              type='button'
              aria-label={`Clear slot ${index + 1}: ${model.name}`}
              className='loadout-clear absolute right-1 top-1 z-10 flex size-6 items-center justify-center rounded-menu-item text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/slot:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring'
              onClick={(event) => {
                const card = event.currentTarget.closest('.loadout-slot')
                if (card) onClear(card.getBoundingClientRect())
              }}
            >
              <XIcon aria-hidden='true' className='size-3' />
            </button>
            <ConfigContent
              model={model}
              slot={slot}
              hidden={!!flight}
              trailing={
                vertical && index === 0 ? (
                  <span className='shrink-0 pr-6 text-xs text-muted-foreground'>Default</span>
                ) : undefined
              }
            >
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  aria-label={`Configure slot ${index + 1}: ${describe(slot)}`}
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
                      onValueChange={(effort) =>
                        onChange({ ...slot, model: model.id, effort: String(effort) })
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
                        onCheckedChange={(fast) => onChange({ ...slot, model: model.id, fast })}
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
      {previous && (
        <motion.div
          key={`${previous.model}:${previous.effort}:${previous.fast}`}
          aria-hidden='true'
          className={`pointer-events-none absolute inset-0 z-10 flex flex-col p-2 ${vertical ? 'loadout-v2-ghost' : ''}`}
          initial={{ transform: 'scale(1)', opacity: previousOpacity, filter: 'blur(0px)' }}
          animate={{
            opacity: 0,
            transform: replacement && !reducedMotion ? 'scale(0.97)' : 'scale(1)',
            filter: reducedMotion ? 'blur(0px)' : 'blur(4px)',
          }}
          transition={{ duration: replacement ? 0.2 : 0.12, ease: 'easeOut' }}
        >
          {previousModel ? (
            <ConfigContent model={previousModel} slot={previous} />
          ) : (
            <div className='flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground'>
              <EmptySlotContent />
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}

// Measure the final card once; animate independent layers so text and logos never stretch.
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
    <div
      ref={ref}
      aria-hidden='true'
      className='loadout-equip-animation pointer-events-none absolute inset-0 z-10'
    >
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

function CatalogModel({ model, disabled = false }: { model: LoadoutModel; disabled?: boolean }) {
  const { ref, handleRef, isDragging } = useDraggable({ id: model.id, disabled })
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

import type { ChatStatus } from 'ai'
import type { CSSProperties, MouseEvent } from 'react'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { composerShell } from '@/components/composer'
import { acceptImages } from '@/lib/attachments'
import { PaperclipIcon, XIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

// Bench for the composer: every state it can be in, side by side, plus a live
// instance that walks the ready → streaming → ready loop. Reuses the real
// PromptInput primitives and the real shell classes so this is visual truth,
// not a mockup.

function RackLabel({ name }: { name: string }) {
  return (
    <div className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
      {name}
    </div>
  )
}

function AttachButton() {
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputButton aria-label='Attach images' onClick={() => attachments.openFileDialog()}>
      <PaperclipIcon className='size-4' />
    </PromptInputButton>
  )
}

function Attachments() {
  return (
    <PromptInputAttachments>
      {(attachment) => <PromptInputAttachment data={attachment} />}
    </PromptInputAttachments>
  )
}

// Lab-only: fabricates a solid-random-color PNG and runs it through the real
// attachment pipeline, so the fan can be exercised without screenshotting.
function SeedButton() {
  const { add } = usePromptInputAttachments()

  function seed() {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 800
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = `hsl(${Math.round(Math.random() * 360)} 50% 55%)`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (blob) add([new File([blob], 'fake-screenshot.png', { type: 'image/png' })])
    }, 'image/png')
  }

  return (
    <PromptInputButton aria-label='Add fake screenshot' onClick={seed}>
      seed
    </PromptInputButton>
  )
}

// Card fan tucked under the composer's top-right corner. All cards share one
// anchor and rotate around a pivot below their bottom edge, so the bottoms
// converge (hidden under the opaque shell) while the tops splay apart like a
// hand of playing cards. Must sit inside PromptInputProvider.
// Pivot offsets are relative to the composer's top-right corner:
// x positive = right of the corner, y positive = below it.
type Pivot = { x: number; y: number }

type FanConfig = {
  pivot: Pivot
  /** fan center angle, deg clockwise from vertical */
  center: number
  /** per-card angle step, deg */
  step: number
  /** total spread cap, deg */
  maxSpread: number
  cardW: number
  cardH: number
  /** base hover push-out, px (each hover adds 0–6px jitter) */
  lift: number
}

const DEFAULT_FAN: FanConfig = {
  pivot: { x: -32, y: 37 },
  center: 13,
  step: 29,
  maxSpread: 84,
  cardW: 70,
  cardH: 95,
  lift: 18,
}

const FAN_SLIDERS: Array<{
  key: Exclude<keyof FanConfig, 'pivot'>
  label: string
  min: number
  max: number
}> = [
  { key: 'center', label: 'center°', min: -45, max: 90 },
  { key: 'step', label: 'step°', min: 2, max: 45 },
  { key: 'maxSpread', label: 'cap°', min: 20, max: 180 },
  { key: 'cardW', label: 'card w', min: 40, max: 120 },
  { key: 'cardH', label: 'card h', min: 48, max: 160 },
  { key: 'lift', label: 'lift', min: 0, max: 40 },
]

function FanControls({
  config,
  onChange,
}: {
  config: FanConfig
  onChange: (next: FanConfig) => void
}) {
  return (
    <div className='mt-3 flex flex-col gap-2 font-mono text-[10px] text-muted-foreground'>
      <div className='grid grid-cols-3 gap-x-6 gap-y-1'>
        {FAN_SLIDERS.map((slider) => (
          <label key={slider.key} className='flex items-center gap-2'>
            <span className='w-12 shrink-0'>{slider.label}</span>
            <input
              type='range'
              min={slider.min}
              max={slider.max}
              value={config[slider.key]}
              onChange={(event) =>
                onChange({ ...config, [slider.key]: Number(event.currentTarget.value) })
              }
              className='min-w-0 flex-1'
            />
            <span className='w-8 shrink-0 text-right text-foreground'>{config[slider.key]}</span>
          </label>
        ))}
      </div>
      <div className='flex items-center justify-between'>
        <span>
          pivot x={config.pivot.x} y={config.pivot.y} · drag the amber dot · from top-right
          corner, +x right / +y down
        </span>
        <button
          type='button'
          className='rounded border border-border px-2 py-0.5 text-foreground hover:bg-secondary'
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(config, null, 2))
            toast.success('Fan values copied')
          }}
        >
          copy values
        </button>
      </div>
    </div>
  )
}

// Lab-only: draggable marker for the fan's pivot; drag it and read the values.
function PivotHandle({ pivot, onChange }: { pivot: Pivot; onChange: (next: Pivot) => void }) {
  const start = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  return (
    <div
      aria-label='Fan pivot'
      className='absolute z-20 size-3 cursor-grab rounded-full bg-amber-400 ring-2 ring-black/60 active:cursor-grabbing'
      style={{ right: -pivot.x - 6, top: pivot.y - 6 }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        start.current = { x: event.clientX, y: event.clientY, px: pivot.x, py: pivot.y }
      }}
      onPointerMove={(event) => {
        const from = start.current
        if (!from) return
        onChange({
          x: Math.round(from.px + event.clientX - from.x),
          y: Math.round(from.py + event.clientY - from.y),
        })
      }}
      onPointerUp={() => {
        start.current = null
      }}
      onPointerCancel={() => {
        start.current = null
      }}
    />
  )
}

function TuckedAttachments({ config }: { config: FanConfig }) {
  const { files, remove } = usePromptInputAttachments()
  const images = files.filter((f) => f.mediaType?.startsWith('image/') && f.url)
  if (images.length === 0) return null

  // Newest last in files → index 0 is the top, most-clockwise card.
  const stack = [...images].reverse()
  // Every card's base is planted at the pivot and the card radiates outward,
  // so the fan wraps the corner; the base overlap hides under the opaque
  // shell.
  const spread =
    stack.length > 1 ? Math.min(config.step * (stack.length - 1), config.maxSpread) : 0
  const step = stack.length > 1 ? spread / (stack.length - 1) : 0
  // hover zone extends past the card by the max lift so a lifted card never
  // escapes the cursor and oscillates
  const zoneH = config.cardH + config.lift + 8

  return (
    <div aria-label='Attached images' className='pointer-events-none absolute top-0 right-0 z-0'>
      {stack.map((file, i) => (
        // Stationary hover zone: carries the rotation (constant per card);
        // only the inner card moves on hover.
        <div
          key={file.id}
          className='group pointer-events-auto absolute [transform:rotate(var(--angle))] transition-transform duration-150 ease-out'
          style={
            {
              // card base-center sits on the pivot (card at the zone's bottom)
              right: -(config.pivot.x + config.cardW / 2),
              top: config.pivot.y - zoneH,
              width: config.cardW,
              height: zoneH,
              '--angle': `${config.center + spread / 2 - i * step}deg`,
              transformOrigin: '50% 100%',
              zIndex: stack.length - i,
            } as CSSProperties
          }
          onPointerEnter={(event) => {
            // no two lifts identical — a card pushed out of a hand never
            // travels the exact same distance twice
            event.currentTarget.style.setProperty(
              '--lift',
              `${-(config.lift + Math.random() * 6)}px`
            )
          }}
        >
          <div
            className='absolute inset-x-0 bottom-0 transition-transform duration-150 ease-out group-hover:[transform:translateY(var(--lift,-16px))]'
            style={{ height: config.cardH }}
          >
            <img
              alt={file.filename || 'attachment'}
              src={file.url}
              className='size-full max-w-none rounded-md bg-secondary object-cover shadow-[0_4px_18px_3px_rgba(0,0,0,0.45)]'
              draggable={false}
            />
            <button
              type='button'
              aria-label={`Remove ${file.filename || 'attachment'}`}
              onClick={() => remove(file.id)}
              className='absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100'
            >
              <XIcon className='size-2.5' />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function BenchComposer({
  status,
  initialInput,
  disabled,
}: {
  status: ChatStatus
  initialInput?: string
  disabled?: boolean
}) {
  return (
    <div className={composerShell}>
      <PromptInputProvider initialInput={initialInput} validateFiles={acceptImages}>
        <PromptInput accept='image/*' multiple onSubmit={() => {}}>
          <Attachments />
          <PromptInputTextarea placeholder='Message the agent…' disabled={disabled} />
          <PromptInputFooter>
            <AttachButton />
            <PromptInputSubmit className='ml-auto' status={status} disabled={disabled} />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}

const BENCH_STATES: Array<{
  label: string
  note: string
  status: ChatStatus
  initialInput?: string
  disabled?: boolean
}> = [
  { label: 'ready · empty', note: 'draft page and idle threads', status: 'ready' },
  {
    label: 'ready · with text',
    note: 'restored draft',
    status: 'ready',
    initialInput: 'Profile the timeline render and find what re-renders per token.',
  },
  {
    label: 'streaming',
    note: 'agent running — submit becomes interrupt',
    status: 'streaming',
    initialInput: 'also check the reducer',
  },
  {
    label: 'sending first turn',
    note: 'thread.create in flight — locked until it lands',
    status: 'submitted',
    initialInput: 'Profile the timeline render.',
    disabled: true,
  },
  {
    label: 'send failed',
    note: 'thread.create rejected — press send to retry',
    status: 'error',
    initialInput: 'Profile the timeline render.',
  },
]

// Ready → streaming on submit, back on interrupt-click or after a fake turn.
function LiveComposer() {
  const [streaming, setStreaming] = useState(false)
  const [fan, setFan] = useState<FanConfig>(DEFAULT_FAN)
  const timer = useRef<number | null>(null)

  function stop() {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    setStreaming(false)
  }

  function handleSubmit(message: PromptInputMessage) {
    if (!message.text.trim() && message.files.length === 0) return
    setStreaming(true)
    timer.current = window.setTimeout(stop, 4000)
  }

  function handleSubmitClick(event: MouseEvent<HTMLButtonElement>) {
    if (!streaming) return
    event.preventDefault()
    stop()
  }

  return (
    <div className='relative'>
      <PromptInputProvider validateFiles={acceptImages}>
        <TuckedAttachments config={fan} />
        <PivotHandle pivot={fan.pivot} onChange={(pivot) => setFan({ ...fan, pivot })} />
        <div className={`${composerShell} relative z-10`}>
          <PromptInput accept='image/*' multiple onSubmit={handleSubmit}>
            <PromptInputTextarea placeholder='Message the agent…' />
            <PromptInputFooter>
              <AttachButton />
              <SeedButton />
              <PromptInputSubmit
                className='ml-auto'
                status={streaming ? 'streaming' : 'ready'}
                onClick={handleSubmitClick}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </PromptInputProvider>
      <FanControls config={fan} onChange={setFan} />
    </div>
  )
}

export function ComposerLab() {
  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-12 p-8'>
      <h1 className='text-2xl font-semibold tracking-tight'>Composer lab</h1>
      <section className='flex flex-col gap-6'>
        <RackLabel name='states' />
        {BENCH_STATES.map((bench) => (
          <div key={bench.label} className='flex flex-col gap-2'>
            <div className='text-xs text-muted-foreground'>
              <span className='text-foreground'>{bench.label}</span> — {bench.note}
            </div>
            <BenchComposer
              status={bench.status}
              initialInput={bench.initialInput}
              disabled={bench.disabled}
            />
          </div>
        ))}
      </section>
      <section className='flex flex-col gap-4'>
        <RackLabel name='live · submit streams for 4s, click again to interrupt · drag the amber dot to move the fan pivot' />
        <LiveComposer />
      </section>
    </div>
  )
}

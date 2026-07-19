import type { ChatStatus } from 'ai'
import type { MouseEvent } from 'react'

import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputTextarea,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import {
  AttachmentFan,
  DEFAULT_FAN,
  type FanConfig,
  type FanPivot,
} from '@/components/attachment-fan'
import { ComposerFooter, composerShell } from '@/components/composer'
import { acceptImages } from '@/lib/attachments'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

// Bench for the composer: every state it can be in, side by side, plus a live
// instance with the fan tuning rig. Renders the REAL composer pieces
// (composerShell, ComposerFooter, AttachmentFan) so this is visual truth,
// not a mockup.

function RackLabel({ name }: { name: string }) {
  return (
    <div className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
      {name}
    </div>
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
    <PromptInputButton size='sm' aria-label='Add fake screenshot' onClick={seed}>
      seed
    </PromptInputButton>
  )
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
function PivotHandle({
  pivot,
  onChange,
}: {
  pivot: FanPivot
  onChange: (next: FanPivot) => void
}) {
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
          <PromptInputTextarea placeholder='Do anything' disabled={disabled} />
          <PromptInputFooter>
            <ComposerFooter status={status} disabled={disabled} />
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
        <AttachmentFan config={fan} />
        <PivotHandle pivot={fan.pivot} onChange={(pivot) => setFan({ ...fan, pivot })} />
        <div className={`${composerShell} relative z-10`}>
          <PromptInput accept='image/*' multiple onSubmit={handleSubmit}>
            <PromptInputTextarea placeholder='Do anything' />
            <PromptInputFooter>
              <ComposerFooter
                status={streaming ? 'streaming' : 'ready'}
                onSubmitClick={handleSubmitClick}
              >
                <SeedButton />
              </ComposerFooter>
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

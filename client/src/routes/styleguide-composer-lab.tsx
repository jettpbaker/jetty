import type { ChatStatus } from 'ai'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PlusIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
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

const MODELS = ['Opus 4.8', 'Sonnet 5', 'Haiku 4.5']
const APPROVAL_MODES = ['Auto', 'Full access', 'Plan']

// The composer footer: add-image and approval picker on the left, model
// picker and send on the right. Extra lab controls slot in via children.
function FooterCluster({
  status,
  disabled,
  onSubmitClick,
  children,
}: {
  status: ChatStatus
  disabled?: boolean
  onSubmitClick?: (event: MouseEvent<HTMLButtonElement>) => void
  children?: ReactNode
}) {
  const attachments = usePromptInputAttachments()
  const [model, setModel] = useState('Sonnet 5')
  const [approval, setApproval] = useState('Auto')
  return (
    <div className='flex w-full items-center gap-1'>
      <PromptInputButton
        aria-label='Add images'
        disabled={disabled}
        onClick={() => attachments.openFileDialog()}
      >
        <PlusIcon className='size-4' />
      </PromptInputButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <PromptInputButton
              size='sm'
              disabled={disabled}
              className='text-muted-foreground transition-colors hover:bg-transparent! hover:text-foreground'
            >
              {approval}
            </PromptInputButton>
          }
        />
        <DropdownMenuContent align='start'>
          {APPROVAL_MODES.map((name) => (
            <DropdownMenuItem key={name} onClick={() => setApproval(name)}>
              {name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {children}
      <div className='ml-auto flex items-center gap-1'>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <PromptInputButton
                size='sm'
                disabled={disabled}
                className='group/model gap-1.5 text-foreground hover:bg-transparent!'
              >
                {model}
                <span className='text-muted-foreground transition-colors group-hover/model:text-foreground'>
                  Medium
                </span>
              </PromptInputButton>
            }
          />
          <DropdownMenuContent align='end'>
            {MODELS.map((name) => (
              <DropdownMenuItem key={name} onClick={() => setModel(name)}>
                {name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <PromptInputSubmit status={status} disabled={disabled} onClick={onSubmitClick} />
      </div>
    </div>
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
    <PromptInputButton size='sm' aria-label='Add fake screenshot' onClick={seed}>
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
        <FanCard
          key={file.id}
          file={file}
          config={config}
          zoneH={zoneH}
          angle={config.center + spread / 2 - i * step}
          zIndex={stack.length - i}
          onRemove={() => remove(file.id)}
        />
      ))}
    </div>
  )
}

// dragging a card farther than this from where it was picked up removes it
const TOSS_DISTANCE = 90

// --- glint light field ---------------------------------------------------
// Miniaturized from the glow engine: light falls off as
// pow(d, -p) * exp(-d / absorption), drawn additively so overlapping rays
// saturate to white. This is light, not paint — no gaussian blurs.

const GLINT_SIZE = 180
const WHITE: [number, number, number] = [255, 255, 255]
const STARLIGHT: [number, number, number] = [190, 212, 255]

// One elliptical emitter: a unit-radius radial gradient with stops sampled
// from the physical kernel, stretched to (hx, hy) half-lengths.
function paintGlow(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  tint: [number, number, number],
  gain: number
) {
  ctx.save()
  ctx.scale(hx, hy)
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  for (let i = 0; i <= 12; i++) {
    // denser samples near the singular center, where the curve is steep
    const d = Math.pow(i / 12, 1.7)
    const raw = gain * Math.pow(d + 0.14, -1.5) * Math.exp(-2.6 * d)
    // soft exposure knee (the pocket AgX): overdriven light rolls toward 1
    // instead of clipping, and the (1-d²) window guarantees the rim reaches
    // zero — beyond the gradient radius canvas repeats the LAST stop, so a
    // non-zero rim paints the whole fill rect
    const intensity = (1 - Math.exp(-raw)) * (1 - d * d)
    grad.addColorStop(d, `rgba(${tint[0]},${tint[1]},${tint[2]},${intensity})`)
  }
  ctx.fillStyle = grad
  ctx.fillRect(-1, -1, 2, 2)
  ctx.restore()
}

// Noise tile for grain, baked once: random alphas stamped with
// destination-out so the grain lives inside the light, not over the page.
let grainTile: HTMLCanvasElement | null = null
function getGrainTile() {
  if (grainTile) return grainTile
  const tile = document.createElement('canvas')
  tile.width = 64
  tile.height = 64
  const ctx = tile.getContext('2d')
  if (!ctx) return null
  const img = ctx.createImageData(64, 64)
  for (let i = 3; i < img.data.length; i += 4) {
    img.data[i] = Math.random() * 44 // alpha only, ≤17%
  }
  ctx.putImageData(img, 0, 0)
  grainTile = tile
  return tile
}

function drawGlint(ctx: CanvasRenderingContext2D, dpr: number, k: number, flash: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, GLINT_SIZE, GLINT_SIZE)
  ctx.translate(GLINT_SIZE / 2, GLINT_SIZE / 2)
  ctx.globalCompositeOperation = 'lighter'
  const g = 0.35 + 0.65 * k
  paintGlow(ctx, 80, 2.6, WHITE, 0.04 * g) // long anamorphic streak
  paintGlow(ctx, 2.4, 40, WHITE, 0.04 * g) // shorter vertical
  ctx.rotate(Math.PI / 4)
  paintGlow(ctx, 30, 1.8, WHITE, 0.025 * g)
  paintGlow(ctx, 1.8, 30, WHITE, 0.025 * g)
  ctx.rotate(-Math.PI / 4)
  paintGlow(ctx, 34, 34, STARLIGHT, 0.02 * g) // cool starlight halo
  paintGlow(ctx, 12 + flash * 5, 12 + flash * 5, WHITE, (0.14 + 0.28 * flash) * g) // warm-not-searing core

  const tile = getGrainTile()
  if (tile) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'destination-out'
    // fresh offset per frame so the grain shimmers instead of sitting still
    ctx.translate(-Math.random() * 64, -Math.random() * 64)
    const pattern = ctx.createPattern(tile, 'repeat')
    if (pattern) {
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, GLINT_SIZE + 64, GLINT_SIZE + 64)
    }
  }
}

// Stationary hover zone carrying the card's rotation; only the inner card
// moves on hover. Dragging follows the cursor in screen space (translate
// outside the rotate); release either tosses the card out of the hand or
// glides it back.
function FanCard({
  file,
  config,
  zoneH,
  angle,
  zIndex,
  onRemove,
}: {
  file: { id: string; url?: string; filename?: string }
  config: FanConfig
  zoneH: number
  angle: number
  zIndex: number
  onRemove: () => void
}) {
  const drag = useRef<{
    x: number
    y: number
    active: boolean
    lastX: number
    lastY: number
    lastT: number
    vx: number
    vy: number
  } | null>(null)
  const fling = useRef<number | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const glintRef = useRef<HTMLDivElement>(null)
  const glintCanvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(
    () => () => {
      if (fling.current) cancelAnimationFrame(fling.current)
    },
    []
  )

  function settleBack(node: HTMLElement) {
    node.style.transition = ''
    node.style.zIndex = ''
    node.style.opacity = ''
    node.style.setProperty('--dx', '0px')
    node.style.setProperty('--dy', '0px')
    node.style.removeProperty('--scale')
  }

  // Ballistic exit: the card keeps its release velocity, gravity bends it
  // into an arc, it spins with the throw, shrinks and snuffs out — and a
  // star glint twinkles at the vanish point before the attachment is
  // actually removed.
  function toss(node: HTMLElement, dx: number, dy: number, vx: number, vy: number) {
    const G = 0.004 // px/ms²
    const FLING_MS = 420
    // a beat of nothing between the vanish and the glint — light arriving
    // late from far away — and a slightly different star every time
    const GLINT_DELAY = FLING_MS + 15 + Math.random() * 10
    const GLINT_MS = 250 + Math.random() * 60
    const glintBase = Math.random() * 90 // deg
    const glintSize = 0.65 + Math.random() * 0.25
    // cap launch speed so hard flicks stay mostly on screen
    const speed = Math.hypot(vx, vy)
    if (speed > 2) {
      vx *= 2 / speed
      vy *= 2 / speed
    }
    const spin = Math.max(-0.3, Math.min(0.3, vx * 0.15)) // deg/ms
    const card = cardRef.current
    const glint = glintRef.current
    const dpr = window.devicePixelRatio || 1
    const canvas = glintCanvasRef.current
    if (canvas) {
      canvas.width = GLINT_SIZE * dpr
      canvas.height = GLINT_SIZE * dpr
    }
    const glintCtx = canvas?.getContext('2d') ?? null
    node.style.pointerEvents = 'none'
    // rAF drives the card's scale/opacity directly; its 150ms transition
    // would smear every frame update
    if (card) card.style.transition = 'none'
    let x = dx
    let y = dy
    const startT = performance.now()
    let last = startT
    function frame(now: number) {
      const elapsed = now - startT
      if (elapsed >= GLINT_DELAY + GLINT_MS) {
        fling.current = null
        onRemove()
        return
      }
      const t = Math.min(1, elapsed / FLING_MS)
      if (t < 1) {
        const dt = Math.min(32, now - last)
        vy += G * dt
        x += vx * dt
        y += vy * dt
        node.style.setProperty('--dx', `${x}px`)
        node.style.setProperty('--dy', `${y}px`)
        node.style.setProperty('--angle', `${angle + spin * elapsed}deg`)
        if (card) {
          // stay solid through most of the arc, then shrink and snuff fast —
          // a linear whole-flight fade reads as a ghost, not a destruction.
          // ^1.5 keeps the shrink gentle at first, steeper into the vanish
          const shrink = Math.max(0, (t - 0.4) / 0.6)
          card.style.scale = `${1 - 0.35 * Math.pow(shrink, 1.5)}`
          card.style.opacity = t < 0.55 ? '1' : `${1 - (t - 0.55) / 0.45}`
        }
      } else if (card) {
        card.style.opacity = '0'
      }
      last = now
      const tg = (elapsed - GLINT_DELAY) / GLINT_MS
      if (glint && tg >= 0) {
        const k = Math.sin(Math.PI * Math.min(1, tg))
        // the ping: the core flares and saturates for a couple frames at peak
        const flash = Math.max(0, 1 - Math.abs(tg - 0.5) / 0.08)
        glint.style.opacity = `${k}`
        glint.style.transform = `scale(${(0.4 + k + flash * 0.2) * glintSize}) rotate(${glintBase + tg * 140}deg)`
        if (glintCtx) drawGlint(glintCtx, dpr, k, flash)
      }
      fling.current = requestAnimationFrame(frame)
    }
    fling.current = requestAnimationFrame(frame)
  }

  return (
    <div
      className='group pointer-events-auto absolute cursor-grab select-none active:cursor-grabbing [transform:translate(var(--dx,0px),var(--dy,0px))_rotate(var(--angle))] transition-transform duration-150 ease-out'
      style={
        {
          // card base-center sits on the pivot (card at the zone's bottom)
          right: -(config.pivot.x + config.cardW / 2),
          top: config.pivot.y - zoneH,
          width: config.cardW,
          height: zoneH,
          '--angle': `${angle}deg`,
          transformOrigin: '50% 100%',
          zIndex,
        } as CSSProperties
      }
      onPointerEnter={(event) => {
        // no two lifts identical — a card pushed out of a hand never travels
        // the exact same distance twice
        event.currentTarget.style.setProperty('--lift', `${-(config.lift + Math.random() * 6)}px`)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // a drag sweeping across the page must not start a text selection
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          active: false,
          lastX: event.clientX,
          lastY: event.clientY,
          lastT: event.timeStamp,
          vx: 0,
          vy: 0,
        }
      }}
      onPointerMove={(event) => {
        const from = drag.current
        if (!from) return
        const dx = event.clientX - from.x
        const dy = event.clientY - from.y
        const node = event.currentTarget
        if (!from.active) {
          if (Math.hypot(dx, dy) < 4) return
          from.active = true
          node.style.transition = 'none'
          node.style.zIndex = '40'
        }
        // smoothed release velocity for the toss ballistics
        const dt = Math.max(1, event.timeStamp - from.lastT)
        from.vx = from.vx * 0.7 + ((event.clientX - from.lastX) / dt) * 0.3
        from.vy = from.vy * 0.7 + ((event.clientY - from.lastY) / dt) * 0.3
        from.lastX = event.clientX
        from.lastY = event.clientY
        from.lastT = event.timeStamp
        node.style.setProperty('--dx', `${dx}px`)
        node.style.setProperty('--dy', `${dy}px`)
        // swell past the toss threshold: release here removes the card
        node.style.setProperty('--scale', Math.hypot(dx, dy) > TOSS_DISTANCE ? '1.07' : '1')
      }}
      onPointerUp={(event) => {
        const from = drag.current
        drag.current = null
        if (!from?.active) return
        const dx = event.clientX - from.x
        const dy = event.clientY - from.y
        if (Math.hypot(dx, dy) > TOSS_DISTANCE) {
          toss(event.currentTarget, dx, dy, from.vx, from.vy)
        } else {
          settleBack(event.currentTarget)
        }
      }}
      onPointerCancel={(event) => {
        if (drag.current?.active) settleBack(event.currentTarget)
        drag.current = null
      }}
    >
      <div
        ref={cardRef}
        className='absolute inset-x-0 bottom-0 overflow-hidden rounded-md shadow-[0_4px_18px_3px_rgba(0,0,0,0.45)] [scale:var(--scale,1)] transition-[transform,scale] duration-150 ease-out group-hover:[transform:translateY(var(--lift,-16px))]'
        style={{ height: config.cardH }}
      >
        <img
          alt={file.filename || 'attachment'}
          src={file.url}
          className='pointer-events-none size-full max-w-none bg-secondary object-cover'
          draggable={false}
        />
      </div>
      {/* glint light field at the card's center, driven by the toss loop */}
      <div
        ref={glintRef}
        className='pointer-events-none absolute left-1/2 opacity-0'
        style={{ top: zoneH - config.cardH / 2 }}
      >
        <canvas
          ref={glintCanvasRef}
          className='absolute -translate-x-1/2 -translate-y-1/2'
          style={{ width: GLINT_SIZE, height: GLINT_SIZE }}
        />
      </div>
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
            <FooterCluster status={status} disabled={disabled} />
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
              <FooterCluster
                status={streaming ? 'streaming' : 'ready'}
                onSubmitClick={handleSubmitClick}
              >
                <SeedButton />
              </FooterCluster>
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

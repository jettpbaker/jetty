import { cn } from '@/lib/utils'
import { useEffect, useId, useRef, type CSSProperties } from 'react'

import {
  botColors,
  botShapes,
  deepBotColors,
  type Body,
  type BotColor,
  type BotShape,
  type BotState,
} from './jetty_bot_shapes'
import './jetty_bot.css'

/* Motion model: damped springs stepped at 120Hz, a few additive loops, and short choreographed moments. */

type Spring = { x: number; v: number; t: number }
const spring = (x: number): Spring => ({ x, v: 0, t: x })
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const wave = (t: number, period: number, phase = 0) => Math.sin((t / period) * Math.PI * 2 + phase)

function step(s: Spring, w: number, z: number, dt: number, snap: boolean) {
  if (snap) {
    s.x = s.t
    s.v = 0
    return
  }
  s.v += (-2 * z * w * s.v - w * w * (s.x - s.t)) * dt
  s.x += s.v * dt
}

const eases = {
  out: (p: number) => 1 - (1 - p) ** 3,
  in: (p: number) => p ** 3,
  inOut: (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
}
type Key = [time: number, value: number, ease?: keyof typeof eases]

/** Piecewise keyframes; each key eases in from the one before it. */
function keyed(keys: Key[], t: number) {
  if (t <= keys[0]![0]) return keys[0]![1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = 'inOut'] = keys[i]!,
      [t0, v0] = keys[i - 1]!
    if (t <= t1) return v0 + (v1 - v0) * eases[ease]((t - t0) / (t1 - t0))
  }
  return keys[keys.length - 1]![1]
}

// Wiggle wave: no arms, so a quick side-to-side rock is its wave.
const WIGGLE_END = 0.66
const wiggle = {
  rot: [
    [0, 0],
    [0.1, 10],
    [0.24, -9],
    [0.38, 7],
    [0.52, -4],
    [WIGGLE_END, 0],
  ] as Key[],
  y: [
    [0, 0],
    [0.1, -2.5],
    [0.56, -1],
    [WIGGLE_END, 0],
  ] as Key[],
}
// Eyes ask: look at you, blink twice, glance to the side, look back. Times from the start of the ask.
const ASK = { blinks: [0.45, 0.71], glance: [1, 2.1] } as const

type Eye = { x: Spring; y: Spring; w: Spring; h: Spring }
const eye = (x: number): Eye => ({ x: spring(x), y: spring(0), w: spring(7.6), h: spring(18.2) })

// Eye poses relative to the face anchor: [x, y, width, height]. Every eye is a pill; a pill flattened
// to nothing gives way to a happy arc.
type Pose = [number, number, number, number]
type Expression = 'open' | 'wide' | 'happy' | 'wink'
const openL: Pose = [-10, 0, 7.6, 18.2],
  openR: Pose = [10, 0, 7.6, 18.2]
const poses: Record<Expression, { L: Pose; R: Pose }> = {
  open: { L: openL, R: openR },
  wide: { L: [-10.5, -1, 9.6, 16.4], R: [10.5, -1, 9.6, 16.4] },
  happy: { L: [-10, 1, 8, 0.2], R: [10, 1, 8, 0.2] },
  wink: { L: [-10, 2.5, 8, 0.2], R: openR },
}

// Done: two hops while stars pop and twinkle in place around it, one after another, then a quick
// wink. The winking eye closes into a bolder, lower arc so it carries the open eye's weight.
const WINK = [0.7, 1.15] as const
const UNREAD_AFTER_DONE = 0.6

const pastelColors = [
  'var(--jb-mint)',
  'var(--jb-aqua)',
  'var(--jb-violet)',
  'var(--jb-pink)',
  'var(--jb-butter)',
]
const twinkles: [number, number, number][] = [
  [14, 22, 1],
  [87, 16, 0.8],
  [94, 62, 0.95],
  [7, 66, 0.75],
  [52, 1, 0.8],
]

/* One ticker for every bot on the page. */

const rigs = new Set<Rig>()
let frame = 0
let last = 0
const pointer = { x: 0, y: 0, active: false }
const reducedQuery =
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)')

function tick(now: number) {
  const t = now / 1000
  const dt = Math.min(0.05, Math.max(0, t - last))
  last = t
  for (const rig of rigs) rig.tick(t, dt)
  frame = rigs.size ? requestAnimationFrame(tick) : 0
}

function track(rig: Rig) {
  rigs.add(rig)
  if (!frame) {
    last = performance.now() / 1000
    frame = requestAnimationFrame(tick)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (event) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.active = true
    },
    { passive: true }
  )
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.active = false
  })
}

type Parts = {
  root: SVGSVGElement
  body: SVGGElement
  face: SVGGElement
  eyes: SVGElement[]
  arcs: SVGPathElement[]
  badge: SVGGElement
  /** The unread dot, in the badge's spot */
  mark: SVGGElement
  twinkles: SVGGElement
}

type Fidget = { kind: 'tilt' | 'look'; until: number; dir: number }

class Rig {
  L = eye(-10)
  R = eye(10)
  // Happy arcs per eye, so one can close in a wink, and how much bigger the winking arc is drawn.
  arcL = spring(0)
  arcR = spring(0)
  winkSize = spring(1)
  gx = spring(0)
  gy = spring(0)
  y = spring(0)
  sy = spring(1)
  rot = spring(0)
  badge = spring(0)
  mark = spring(0)
  bx = spring(77)
  by = spring(25)
  state: BotState = 'idle'
  unread = false
  since = 0
  now = 0
  seed = Math.random() * 10
  nextBlink = 0
  blinkAt = -1
  nextGlance = 0
  glance: [number, number, number] = [0, 0, 0]
  nextFidget = 0
  fidget: Fidget | null = null
  wiggleAt = -10
  askAt = -10
  lastY = 0
  pokedAt = -10
  queue: { at: number; run: () => void }[] = []
  visible = true
  acc = 0
  parts!: Parts
  replay = false
  follow = false

  constructor() {
    this.now = performance.now() / 1000
    this.since = this.now
    this.nextBlink = this.now + rand(1, 4)
    this.nextGlance = this.now + rand(2, 6)
    this.nextFidget = this.now + rand(3, 9)
  }

  /** Point the rig at freshly rendered parts. Its state, springs, and pending moments carry over. */
  attach(parts: Parts, options: { replay: boolean; follow: boolean }) {
    this.parts = parts
    this.replay = options.replay
    this.follow = options.follow
  }

  get reduced() {
    return reducedQuery?.matches ?? false
  }

  later(delay: number, run: () => void) {
    this.queue.push({ at: this.now + delay, run })
  }

  setState(state: BotState) {
    if (state === this.state) return
    this.state = state
    this.since = this.now
    this.queue = []
    this.fidget = null
    this.enter()
  }

  /** The one-off moment when a state begins. Needs you repeats it; replayed specimens repeat done too. */
  enter() {
    if (this.reduced) return
    const { state } = this
    // Done: two hops, and the stars around it start to twinkle.
    if (state === 'done') {
      this.hop(150)
      this.later(0.34, () => this.hop(115))
      this.later(0.1, () => this.play(this.parts.twinkles))
    }
    // Needs you: a wiggle wave (the badge jiggles after it), then once it's still, the eyes ask.
    if (state === 'waiting') {
      this.wiggleAt = this.now
      this.askAt = this.now + 0.75
      for (const at of ASK.blinks)
        this.later(0.75 + at, () => {
          this.blinkAt = this.now
        })
    }
  }

  hop(force: number) {
    this.y.v -= force
    this.sy.v += force / 70
  }

  /** Restart a one-shot CSS effect, placed where the body is right now. */
  play(el: SVGGElement) {
    el.setAttribute('transform', `translate(0 ${this.lastY.toFixed(2)})`)
    el.classList.remove('jb-playing')
    void el.getBoundingClientRect()
    el.classList.add('jb-playing')
  }

  poke() {
    this.pokedAt = this.now
    this.blinkAt = this.now
    if (this.reduced) return
    this.sy.v -= 4
    this.later(0.09, () => this.hop(130))
  }

  expression(age: number): Expression {
    if (this.now - this.pokedAt < 0.7) return 'happy'
    switch (this.state) {
      case 'waiting':
        return 'wide'
      case 'done':
        return !this.reduced && age > WINK[0] && age < WINK[1] ? 'wink' : 'open'
      default:
        return 'open'
    }
  }

  tick(t: number, dt: number) {
    this.now = t
    if (!this.visible) return
    const reduced = this.reduced
    const { state } = this

    const due = this.queue.filter((item) => item.at <= t)
    this.queue = this.queue.filter((item) => item.at > t)
    for (const item of due) item.run()

    if (!reduced) {
      const again =
        state === 'waiting' ? (this.replay ? 4.6 : 6) : state === 'done' && this.replay ? 3.8 : 0
      if (again && t - this.since > again) {
        this.since = t
        this.enter()
      }
    }
    const age = t - this.since
    const expression = this.expression(age)
    const pose = poses[expression]

    // Eyes
    const set = (e: Eye, p: Pose) => {
      e.x.t = p[0]
      e.y.t = p[1]
      e.w.t = p[2]
      e.h.t = p[3]
    }
    set(this.L, pose.L)
    set(this.R, pose.R)
    this.arcL.t = expression === 'happy' || expression === 'wink' ? 1 : 0
    this.arcR.t = expression === 'happy' ? 1 : 0
    this.winkSize.t = expression === 'wink' ? 1.4 : 1

    // Idle fidgets: now and then a hop, a curious tilt, a wiggle, or a look around.
    if (!reduced && state === 'idle' && t > this.nextFidget) {
      const dir = Math.random() < 0.5 ? -1 : 1
      const kind = ['hop', 'tilt', 'wiggle', 'look'][Math.floor(Math.random() * 4)]
      if (kind === 'hop') {
        this.hop(105)
        this.later(0.16, () => {
          this.blinkAt = this.now
        })
      }
      if (kind === 'wiggle') {
        this.rot.v += 230 * dir
        this.blinkAt = t
        this.nextBlink = t + 0.26
      }
      if (kind === 'tilt' || kind === 'look') this.fidget = { kind, until: t + 1.5, dir }
      this.nextFidget = t + rand(7, 13)
    }
    if (this.fidget && t > this.fidget.until) this.fidget = null

    // Gaze
    let gaze: [number, number] = [0, 0]
    if (state === 'idle') {
      if (t > this.nextGlance) {
        this.glance = [rand(-5.5, 5.5), rand(-3.5, 2.5), t + rand(0.9, 1.8)]
        this.nextGlance = t + rand(3.5, 7.5)
      }
      if (t < this.glance[2]) gaze = [this.glance[0], this.glance[1]]
      if (this.fidget?.kind === 'tilt') gaze = [4.5 * this.fidget.dir, -2.5]
      if (this.fidget?.kind === 'look')
        gaze = [(this.fidget.until - t > 0.75 ? -5.5 : 5.5) * this.fidget.dir, 0.5]
    }
    const ask = t - this.askAt
    const glancing = state === 'waiting' && ask > ASK.glance[0] && ask < ASK.glance[1]
    const asking = state === 'waiting' && ask > -0.1 && ask < ASK.glance[1] + 0.3
    if (state === 'waiting') gaze = glancing ? [6, 1.5] : [0, -1.5]
    if (state === 'done') gaze = expression === 'wink' ? [1.5, -1] : [0, -1]
    if (
      this.follow &&
      pointer.active &&
      (state === 'idle' || state === 'waiting') &&
      !reduced &&
      !this.fidget &&
      !asking
    ) {
      const box = this.parts.root.getBoundingClientRect()
      const dx = pointer.x - (box.left + box.width / 2),
        dy = pointer.y - (box.top + box.height / 2)
      const reach = Math.min(1, Math.hypot(dx, dy) / (box.width * 2.4)),
        angle = Math.atan2(dy, dx)
      gaze = [Math.cos(angle) * reach * 6.5, Math.sin(angle) * reach * 4.5]
    }
    this.gx.t = gaze[0]
    this.gy.t = gaze[1]

    // Body
    this.y.t = state === 'waiting' ? -1 : 0
    this.rot.t =
      this.fidget?.kind === 'tilt'
        ? 9 * this.fidget.dir
        : glancing
          ? 5
          : expression === 'wink'
            ? 7
            : 0
    this.badge.t = state === 'waiting' ? 1 : 0
    // Unread waits for the turn to end: never while working, and Needs you's badge outranks it.
    // After done, it pops in once the hops have landed.
    const settled =
      state === 'idle' || (state === 'done' && (reduced || this.replay || age > UNREAD_AFTER_DONE))
    this.mark.t = this.unread && settled ? 1 : 0

    // Integrate at a fixed 120Hz so motion is the same at any frame rate
    this.acc += dt
    while (this.acc >= 1 / 120) {
      const h = 1 / 120
      this.acc -= h
      for (const e of [this.L, this.R]) {
        step(e.x, 30, 0.72, h, reduced)
        step(e.y, 30, 0.72, h, reduced)
        step(e.w, 32, 0.66, h, reduced)
        step(e.h, 32, 0.66, h, reduced)
      }
      step(this.arcL, 36, 1, h, reduced)
      step(this.arcR, 36, 1, h, reduced)
      step(this.winkSize, 24, 1, h, reduced)
      step(this.gx, 17, 0.86, h, reduced)
      step(this.gy, 17, 0.86, h, reduced)
      step(this.y, 15, 0.4, h, reduced)
      step(this.sy, 21, 0.3, h, reduced)
      step(this.rot, 26, 0.24, h, reduced)
      step(this.badge, 20, 0.42, h, reduced)
      step(this.mark, 20, 0.42, h, reduced)
      step(this.bx, 15, 0.3, h, reduced)
      step(this.by, 15, 0.3, h, reduced)
    }

    // Additive loops: breath and sway. Non-syncing periods keep them organic.
    let y = this.y.x,
      sy = this.sy.x,
      rot = this.rot.x
    if (!reduced) {
      const s = this.seed
      sy += 0.012 * wave(t, 3.6, s)
      y -= 0.5 * wave(t, 3.6, s)
      rot += 1.1 * wave(t, 5.3, s * 2)
      if (state === 'waiting') rot += 2.5 * wave(t, 2.6, s)
      const w = t - this.wiggleAt
      if (state === 'waiting' && w < WIGGLE_END) {
        rot += keyed(wiggle.rot, w)
        y += keyed(wiggle.y, w)
      }
    }

    // Blink, applied only to open pill eyes
    let lid = 1
    const blinking = expression === 'open' || expression === 'wide'
    if (!reduced && blinking && t > this.nextBlink) {
      this.blinkAt = t
      this.nextBlink = t + (Math.random() < 0.18 ? 0.26 : rand(2.4, 6))
    }
    const since = t - this.blinkAt
    if (since < 0.17 && blinking)
      lid = since < 0.06 ? 1 - (since / 0.06) * 0.88 : 0.12 + ((since - 0.06) / 0.11) * 0.88

    this.lastY = y
    this.draw(y, sy, rot, lid)
  }

  draw(y: number, sy: number, rot: number, lid: number) {
    const { parts } = this
    // Squash and tilt pivot on the bottom of the body, as if it sits on the ground.
    const sx = 1 + (1 - sy) * 0.6
    parts.body.setAttribute(
      'transform',
      `translate(0 ${y.toFixed(2)}) rotate(${rot.toFixed(2)} 50 88) translate(50 88) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-50 -88)`
    )

    const gx = this.gx.x,
      gy = this.gy.x
    const base = parts.face.dataset
    parts.face.setAttribute(
      'transform',
      `translate(${(+base.x! + gx * 0.4).toFixed(2)} ${(+base.y! + gy * 0.4).toFixed(2)}) scale(${base.s})`
    )

    for (const [i, e] of [this.L, this.R].entries()) {
      const w = Math.max(0.01, e.w.x),
        h = Math.max(0.01, e.h.x * lid)
      const cx = e.x.x + gx,
        cy = e.y.x + gy
      const rect = parts.eyes[i]!
      rect.setAttribute('x', (cx - w / 2).toFixed(2))
      rect.setAttribute('y', (cy - h / 2).toFixed(2))
      rect.setAttribute('width', w.toFixed(2))
      rect.setAttribute('height', h.toFixed(2))
      rect.setAttribute('rx', (Math.min(w, h) / 2).toFixed(2))
      rect.setAttribute('opacity', clamp01((h - 0.6) / 1.4).toFixed(3))
      parts.arcs[i]!.setAttribute(
        'transform',
        `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${(i === 0 ? this.winkSize.x : 1).toFixed(3)})`
      )
      parts.arcs[i]!.setAttribute(
        'opacity',
        clamp01((i === 0 ? this.arcL : this.arcR).x).toFixed(3)
      )
    }

    // The badge is tucked into the body's upper right and rides its tilt, squash, and hops. It chases
    // that spot on a spring instead of sticking to it, so it lags, overshoots, and stretches as it goes.
    const b = Math.max(0, this.badge.x)
    const turn = (rot * Math.PI) / 180
    const px = (77 - 50) * sx,
      py = (25 - 88) * sy
    const tx = 50 + px * Math.cos(turn) - py * Math.sin(turn),
      ty = 88 + px * Math.sin(turn) + py * Math.cos(turn) + y
    this.bx.t = tx
    this.by.t = ty
    let spot = `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`
    if (!this.reduced) {
      const speed = Math.hypot(this.bx.v, this.by.v),
        stretch = Math.min(0.22, speed / 640)
      const angle = (Math.atan2(this.by.v, this.bx.v) * 180) / Math.PI
      spot = `translate(${this.bx.x.toFixed(2)} ${this.by.x.toFixed(2)}) rotate(${angle.toFixed(1)}) scale(${(1 + stretch).toFixed(3)} ${(1 - stretch * 0.5).toFixed(3)}) rotate(${(-angle).toFixed(1)})`
    } else {
      this.bx.x = tx
      this.by.x = ty
      this.bx.v = 0
      this.by.v = 0
    }
    parts.badge.setAttribute('transform', `${spot} scale(${b.toFixed(3)})`)
    parts.badge.style.display = b < 0.01 ? 'none' : ''
    const m = Math.max(0, this.mark.x)
    parts.mark.setAttribute('transform', `${spot} scale(${m.toFixed(3)})`)
    parts.mark.style.display = m < 0.01 ? 'none' : ''
  }
}

/* Drawing */

function BodyFill({ body }: { body: Body }) {
  if (body.d) return <path className='jb-body' d={body.d} />
  return (
    <g className='jb-body'>
      {body.circles!.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ))}
    </g>
  )
}

// clipPath only takes shapes, so circles go in one by one.
function BodyClip({ body }: { body: Body }) {
  if (body.d) return <path d={body.d} />
  return (
    <>
      {body.circles!.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ))}
    </>
  )
}

const STAR = 'M0 -1 Q0.16 -0.16 1 0 Q0.16 0.16 0 1 Q-0.16 0.16 -1 0 Q-0.16 -0.16 0 -1 Z'

export type JettyBotProps = {
  shape?: BotShape
  color?: BotColor
  state?: BotState
  size?: number
  /** Replay done on a loop so a static specimen keeps showing it. */
  replay?: boolean
  /** Eyes follow the pointer while idle. */
  follow?: boolean
  /** Click or tap to boop. */
  interactive?: boolean
  /** It has sent messages you haven't seen. A blue dot shows it once its turn is over. */
  unread?: boolean
  /** A ring in the colour it sits on, so faces stacked over each other stay apart. */
  outlined?: boolean
  label?: string
  className?: string
  style?: CSSProperties
}

export function JettyBot({
  shape = 'circle',
  color = 'lilac',
  state = 'idle',
  size = 40,
  replay = false,
  follow = false,
  interactive = false,
  unread = false,
  outlined = false,
  label,
  className,
  style,
}: JettyBotProps) {
  const id = `jb${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const root = useRef<SVGSVGElement>(null)
  const rig = useRef<Rig | null>(null)
  const body = botShapes[shape]
  // Small avatars get proportionally bigger eyes so the face still reads in a sidebar.
  const boost = size <= 24 ? 1.3 : size <= 32 ? 1.14 : 1
  const face = { ...body.face, s: body.face.s * boost }

  useEffect(() => {
    const svg = root.current
    if (!svg) return
    const q = <T extends Element>(part: string) => svg.querySelector<T>(`[data-jb="${part}"]`)!
    const parts: Parts = {
      root: svg,
      body: q<SVGGElement>('body'),
      face: q<SVGGElement>('face'),
      eyes: ['L', 'R'].map((part) => q<SVGElement>(`eye-${part}`)),
      arcs: ['L', 'R'].map((part) => q<SVGPathElement>(`arc-${part}`)),
      badge: q<SVGGElement>('badge'),
      mark: q<SVGGElement>('mark'),
      twinkles: q<SVGGElement>('twinkles'),
    }
    // One rig per avatar for its whole life. It starts idle and the effect below moves it on, so a
    // remount (StrictMode, a new shape) re-attaches without losing a moment that is mid-flight.
    if (!rig.current) rig.current = new Rig()
    const current = rig.current
    current.attach(parts, { replay, follow })
    const observer = new IntersectionObserver(([entry]) => {
      current.visible = entry!.isIntersecting
    })
    observer.observe(svg)
    track(current)
    return () => {
      rigs.delete(current)
      observer.disconnect()
    }
  }, [id, shape, replay, follow])

  useEffect(() => {
    rig.current?.setState(state)
  }, [state])
  useEffect(() => {
    if (rig.current) rig.current.unread = unread
  }, [unread])

  return (
    <svg
      ref={root}
      viewBox='0 0 100 100'
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-state={state}
      data-color={color}
      className={cn('jb', interactive && 'jb-interactive', className)}
      style={
        {
          // Inline, so a Button's glyph sizing can't override the face's size.
          width: size,
          height: size,
          '--jb-body': botColors[color],
          '--jb-deep': deepBotColors[color],
          ...style,
        } as CSSProperties
      }
      onPointerDown={interactive ? () => rig.current?.poke() : undefined}
    >
      <defs>
        <clipPath id={`${id}-face`}>
          <BodyClip body={body} />
        </clipPath>
      </defs>
      <g data-jb='body'>
        {outlined && (
          <g className='jb-outline'>
            <BodyClip body={body} />
          </g>
        )}
        <BodyFill body={body} />
        {/* Eyes are clipped to the body, so a glance toward the edge reads as the body turning. */}
        <g clipPath={`url(#${id}-face)`}>
          <Face face={face} />
        </g>
      </g>
      <g data-jb='twinkles'>
        {twinkles.map(([x, yy, scale], i) => (
          <g key={i} transform={`translate(${x} ${yy})`}>
            <path
              className='jb-twinkle'
              d={STAR}
              transform={`scale(${(scale * 8.5).toFixed(2)})`}
              style={{ fill: pastelColors[i % pastelColors.length], animationDelay: `${i * 90}ms` }}
            />
          </g>
        ))}
      </g>
      <g data-jb='mark' style={{ display: 'none' }}>
        <circle r='14' className='jb-badge-ring' />
        <circle r='10.5' className='jb-mark-dot' />
      </g>
      <g data-jb='badge' style={{ display: 'none' }}>
        <circle r='14' className='jb-badge-ring' />
        <circle r='10.5' className='jb-badge-dot' />
      </g>
    </svg>
  )
}

function Face({ face }: { face: Body['face'] }) {
  return (
    <g
      data-jb='face'
      data-x={face.x}
      data-y={face.y}
      data-s={face.s}
      transform={`translate(${face.x} ${face.y}) scale(${face.s})`}
    >
      {['L', 'R'].map((part) => (
        <rect key={part} data-jb={`eye-${part}`} className='jb-eye' />
      ))}
      {['L', 'R'].map((part) => (
        <path
          key={part}
          data-jb={`arc-${part}`}
          className='jb-arc'
          d='M-4.8 1.8 Q0 -4.2 4.8 1.8'
          opacity='0'
        />
      ))}
    </g>
  )
}

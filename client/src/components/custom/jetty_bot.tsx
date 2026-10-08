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

/** A bouncing dot's lift for dot i (0 to 2), 0 to 1, as in a typing indicator. */
function dotLift(age: number, i: number) {
  const p = ((age - 0.3) / 1.1 - i * 0.15) % 1
  return p > 0 && p < 0.42 ? Math.sin((p / 0.42) * Math.PI) : 0
}

type Eye = { x: Spring; y: Spring; w: Spring; h: Spring }
const eye = (x: number): Eye => ({ x: spring(x), y: spring(0), w: spring(7.6), h: spring(18.2) })

// Eye poses relative to the face anchor: [x, y, width, height]. Every eye is a pill; a pill flattened
// to nothing gives way to a happy arc.
type Pose = [number, number, number, number]
type Expression = 'open' | 'focus' | 'wide' | 'happy' | 'wink'
const openL: Pose = [-10, 0, 7.6, 18.2],
  openR: Pose = [10, 0, 7.6, 18.2]
const poses: Record<Expression, { L: Pose; R: Pose }> = {
  open: { L: openL, R: openR },
  focus: { L: [-10, 1.5, 7.8, 13.6], R: [10, 1.5, 7.8, 13.6] },
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

// Working: it juggles a ball, a star, and a square over its head in the classic cascade, the
// figure-eight where each crosses side to side, caught on the outside and thrown from the inside like
// a real juggler's. They spin as they fly, and its eyes follow the top one. The hands are invisible
// spots beside the face, and throws peak a little above the box so the arcs clear its head. Beats in
// seconds.
const JUGGLE = { beat: 0.38, apex: -5, spread: 36, reach: 4.5, flight: 2.3 }
const juggledColors = ['var(--jb-pink)', 'var(--jb-butter)', 'var(--jb-mint)']
const mod = (n: number, m: number) => ((n % m) + m) % m

/** Where thing i is at beat time s, in the 100 box. Throws alternate hands every beat, and each thing
 * is thrown every third beat, from the other hand. */
function juggled(s: number, i: number, faceY: number): [number, number] {
  const { apex, spread, reach, flight } = JUGGLE
  const hy = faceY - 2,
    p = mod(s - i, 6),
    q = p % 3
  const dir = (i + (p >= 3 ? 1 : 0)) % 2 === 0 ? 1 : -1,
    to = 50 + spread * dir
  if (q < flight) {
    const u = q / flight,
      x0 = 50 - spread * dir + reach * dir,
      x1 = to + reach * dir
    return [x0 + (x1 - x0) * u, hy - (hy - apex) * 4 * u * (1 - u)]
  }
  // Caught on the outside, it scoops down and in to be thrown again.
  const v = (q - flight) / (3 - flight),
    x0 = to + reach * dir,
    x1 = to - reach * dir
  return [x0 + (x1 - x0) * v, hy + 3.5 * Math.sin(Math.PI * v)]
}

// Typing: it looks down and taps away in quick bounces, then pauses to look up and think. beat is
// one tap. A speech bubble with bouncing dots, tucked into its upper right, says it's a reply.
const TAP = { cycle: 3.4, typing: 2.6, beat: 0.18 }
// The bubble is a pill (two semicircles about (10, -14) and (20, -14), radius 10) with a short tail
// off its lower-left curve. It's drawn from the tail tip at the origin, so it pops out of the body.
const BUBBLE =
  'M10 -24 H20 A10 10 0 0 1 20 -4 H6.6 Q4 -2.4 0 0 Q1.4 -3.6 2.34 -7.57 A10 10 0 0 1 10 -24 Z'
const BUBBLE_AT = { x: 65, y: 34, scale: 1.35 }

// Tidying up, for a wait that can run to minutes: a little pile of notes on its head. A new one drops on
// askew, it taps the pile square with two hops, then the top two press into one. Times in seconds into
// each cycle. Rest centres sink 3 into the head, so the pile sits on it.
const TIDY = {
  cycle: 4.6,
  w: 38,
  h: 8,
  gap: 2,
  fall: 0.55,
  taps: [0.95, 1.35],
  // How askew the new note is, squared up a step as each tap lands; the one under it is knocked a little.
  mess: [
    [0, 1],
    [1.1, 1],
    [1.2, 0.45, 'out'],
    [1.5, 0.45],
    [1.6, 0, 'out'],
  ] as Key[],
  knock: [
    [0, 0],
    [0.55, 0],
    [0.62, 1, 'out'],
    [1.1, 1],
    [1.2, 0.45, 'out'],
    [1.5, 0.45],
    [1.6, 0, 'out'],
  ] as Key[],
  merge: [
    [2, 0],
    [2.5, 1],
  ] as Key[],
  press: [
    [2, 0],
    [2.3, -0.05],
    [2.6, 0],
  ] as Key[],
}

/** Note i's [x, y, rotation, opacity, colour] in the body's box, on a head whose top is at `top`. The new
 * note ends each cycle covering the one under it, which takes its colour as the next one starts. */
function note(
  age: number,
  i: number,
  top: number,
  reduced: boolean
): [number, number, number, number, number] {
  const c = reduced ? 0 : Math.floor(age / TIDY.cycle),
    p = reduced ? 1.7 : age % TIDY.cycle,
    dir = c % 2 ? -1 : 1
  const rest = (n: number) => top + 3 - TIDY.h / 2 - n * (TIDY.h + TIDY.gap)
  if (i === 0) return [50, rest(0), 0, 1, 0]
  if (i === 1) {
    const knock = keyed(TIDY.knock, p)
    return [50 - 3 * dir * knock, rest(1), -5 * dir * knock, 1, 1 + (c % 4)]
  }
  const fall = eases.in(clamp01(p / TIDY.fall)),
    mess = keyed(TIDY.mess, p)
  const y = rest(2) - 46 * (1 - fall) + (rest(1) - rest(2)) * keyed(TIDY.merge, p)
  // It tumbles a little on the way down and lands at 16°.
  const rot = p < TIDY.fall ? 28 - 12 * fall : 16 * mess
  return [50 + 8 * dir * mess, y, rot * dir, clamp01(p / 0.12), 1 + ((c + 1) % 4)]
}

/** Whether a looping moment `at` seconds into each cycle came due since the last frame. */
const crossed = (from: number, to: number, cycle: number, at: number) =>
  Math.floor((to - at) / cycle) > Math.floor((from - at) / cycle)

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
  bubble: SVGGElement
  bubbleDots: SVGCircleElement[]
  twinkles: SVGGElement
  juggled: SVGGElement[]
  /** The tidying-up pile of notes, riding the body, and each note in it */
  notes: SVGGElement
  sheets: SVGRectElement[]
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
  juggleIn = spring(0)
  typeIn = spring(0)
  // The tidying-up notes, and since when, so they play on as they leave.
  notesIn = spring(0)
  notesSince = 0
  // The body's top in the box, where the notes sit.
  top = 11
  lastAge = 0
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
    this.top = parts.root.querySelector<SVGGraphicsElement>('.jb-body')?.getBBox().y || 11
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
    this.lastAge = 0
    this.queue = []
    this.fidget = null
    if (state === 'tidying') this.notesSince = this.now
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
    if (state === 'thinking') this.sy.v -= 2.6
    if (state === 'working') {
      this.y.v += 80
      this.sy.v -= 1.8
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
      case 'thinking':
        return 'focus'
      case 'working':
        return 'focus'
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

    // Tidying up: a note lands, then two taps square the pile, once a cycle.
    if (state === 'tidying' && !reduced) {
      const at = (when: number) => crossed(this.lastAge, age, TIDY.cycle, when)
      if (at(TIDY.fall)) this.sy.v -= 1.4
      for (const tap of TIDY.taps) if (at(tap)) this.hop(55)
    }
    this.lastAge = age

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
    const working = state === 'working'
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
    const tapping = state === 'thinking',
      pausing = tapping && age % TAP.cycle > TAP.typing
    // Typing: its eyes dart side to side as it taps, then glance up while it thinks.
    if (tapping)
      gaze = pausing ? [3, -3.5] : [reduced ? 0 : Math.sin(age * Math.PI * 10) * 1.6, 3.2]
    // Juggling, it looks up at whichever is highest.
    if (working) {
      const top = [0, 1, 2]
        .map((i) => juggled(t / JUGGLE.beat, i, +this.parts.face.dataset.y!))
        .sort((a, b) => a[1] - b[1])[0]
      gaze = reduced ? [0, -2] : [Math.max(-6.5, Math.min(6.5, (top![0] - 50) * 0.22)), -3.5]
    }
    const ask = t - this.askAt
    const glancing = state === 'waiting' && ask > ASK.glance[0] && ask < ASK.glance[1]
    const asking = state === 'waiting' && ask > -0.1 && ask < ASK.glance[1] + 0.3
    if (state === 'waiting') gaze = glancing ? [6, 1.5] : [0, -1.5]
    if (state === 'done') gaze = expression === 'wink' ? [1.5, -1] : [0, -1]
    // Tidying, it watches the new note drop, then keeps an eye on the pile.
    const tidy = age % TIDY.cycle,
      side = Math.floor(age / TIDY.cycle) % 2 ? -1 : 1
    if (state === 'tidying') gaze = !reduced && tidy < TIDY.fall + 0.1 ? [3 * side, -4.5] : [0, -4]
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
    this.y.t = state === 'thinking' || state === 'waiting' ? -1 : 0
    this.rot.t = pausing
      ? 5
      : this.fidget?.kind === 'tilt'
        ? 9 * this.fidget.dir
        : glancing
          ? 5
          : expression === 'wink'
            ? 7
            : 0
    // The tidying-up press steers the spring, so leaving mid-press settles instead of snapping.
    this.sy.t = state === 'tidying' && !reduced ? 1 + keyed(TIDY.press, tidy) : 1
    this.notesIn.t = state === 'tidying' ? 1 : 0
    this.typeIn.t = tapping ? 1 : 0
    this.badge.t = state === 'waiting' ? 1 : 0
    // Unread waits for the turn to end: never while typing or working, and Needs you's badge outranks it.
    // After done, it pops in once the hops have landed.
    const settled =
      state === 'idle' || (state === 'done' && (reduced || this.replay || age > UNREAD_AFTER_DONE))
    this.mark.t = this.unread && settled ? 1 : 0
    this.juggleIn.t = working ? 1 : 0

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
      step(this.juggleIn, 18, 0.5, h, reduced)
      step(this.typeIn, 20, 0.5, h, reduced)
      step(this.notesIn, 18, 0.6, h, reduced)
    }

    // Additive loops: breath, sway, and the typing and working rhythms. Non-syncing periods keep them organic.
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
      // Typing: quick little bounces, one per tap, until it stops to think.
      if (tapping && !pausing) {
        const tap = Math.abs(Math.sin((age / TAP.beat) * Math.PI))
        y -= 1.3 * tap
        sy += 0.02 * tap
      }
      // Juggling: it sways toward each throw and dips a little as it goes.
      if (working) {
        const beat = Math.sin((t / JUGGLE.beat) * Math.PI)
        rot += 2.2 * beat
        y -= 0.6 * Math.abs(beat)
      }
    }

    // Blink, applied only to open pill eyes
    let lid = 1
    const blinking = expression === 'open' || expression === 'focus' || expression === 'wide'
    if (!reduced && blinking && t > this.nextBlink) {
      this.blinkAt = t
      this.nextBlink = t + (Math.random() < 0.18 ? 0.26 : rand(2.4, 6))
    }
    const since = t - this.blinkAt
    if (since < 0.17 && blinking)
      lid = since < 0.06 ? 1 - (since / 0.06) * 0.88 : 0.12 + ((since - 0.06) / 0.11) * 0.88

    this.lastY = y
    this.draw(age, y, sy, rot, lid)
  }

  draw(age: number, y: number, sy: number, rot: number, lid: number) {
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

    // Typing bubble: pops out on a spring from its tail, and its dots bounce like a typing indicator.
    const bubble = Math.max(0, this.typeIn.x)
    parts.bubble.style.display = bubble > 0.02 ? '' : 'none'
    parts.bubble.setAttribute(
      'transform',
      `translate(${BUBBLE_AT.x} ${BUBBLE_AT.y}) scale(${(bubble * BUBBLE_AT.scale).toFixed(3)})`
    )
    for (const [i, dot] of parts.bubbleDots.entries())
      dot.setAttribute('cy', (-14 - (this.reduced ? 0 : dotLift(age, i)) * 2).toFixed(2))

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

    // Juggled things pop in wherever they are in the pattern, and spin as they fly.
    const juggle = Math.max(0, this.juggleIn.x),
      beats = this.reduced ? 1.2 : this.now / JUGGLE.beat
    for (const [i, thing] of parts.juggled.entries()) {
      thing.style.display = juggle > 0.02 ? '' : 'none'
      if (juggle <= 0.02) continue
      const [jx, jy] = juggled(beats, i, +base.y!),
        spin = beats * 60 * (i % 2 ? -1 : 1)
      thing.setAttribute(
        'transform',
        `translate(${jx.toFixed(2)} ${jy.toFixed(2)}) rotate(${spin.toFixed(1)}) scale(${juggle.toFixed(3)})`
      )
    }

    // The tidying-up notes play on from when they began, so they wind down where they are as they leave.
    const notes = Math.max(0, this.notesIn.x)
    parts.notes.style.display = notes > 0.02 ? '' : 'none'
    if (notes > 0.02) {
      parts.notes.setAttribute(
        'transform',
        `translate(50 ${this.top.toFixed(2)}) scale(${notes.toFixed(3)}) translate(-50 ${(-this.top).toFixed(2)})`
      )
      for (const [i, sheet] of parts.sheets.entries()) {
        const [nx, ny, turn, opacity, colour] = note(
          this.now - this.notesSince,
          i,
          this.top,
          this.reduced
        )
        sheet.setAttribute(
          'transform',
          `translate(${nx.toFixed(2)} ${ny.toFixed(2)}) rotate(${turn.toFixed(2)})`
        )
        sheet.setAttribute('opacity', opacity.toFixed(3))
        sheet.style.fill = pastelColors[colour]!
      }
    }
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

const BIG_STAR = 'M0 -10 Q2.4 -2.4 10 0 Q2.4 2.4 0 10 Q-2.4 2.4 -10 0 Q-2.4 -2.4 0 -10 Z'

function Juggled({ i }: { i: number }) {
  const style = { fill: juggledColors[i] }
  if (i === 1) return <path d={BIG_STAR} style={style} />
  if (i === 2) return <rect x='-6.4' y='-6.4' width='12.8' height='12.8' rx='3' style={style} />
  return <circle r='8.4' style={style} />
}

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
      bubble: q<SVGGElement>('bubble'),
      bubbleDots: [...q<SVGGElement>('bubble').querySelectorAll('circle')],
      twinkles: q<SVGGElement>('twinkles'),
      juggled: [...q<SVGGElement>('juggled').children] as SVGGElement[],
      notes: q<SVGGElement>('notes'),
      sheets: [...q<SVGGElement>('notes').children] as SVGRectElement[],
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
        <BodyFill body={body} />
        {/* Eyes are clipped to the body, so a glance toward the edge reads as the body turning. */}
        <g clipPath={`url(#${id}-face)`}>
          <Face face={face} />
        </g>
        <g data-jb='notes' style={{ display: 'none' }}>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={-TIDY.w / 2} y={-TIDY.h / 2} width={TIDY.w} height={TIDY.h} rx='3' />
          ))}
        </g>
        <g data-jb='bubble' style={{ display: 'none' }}>
          <path className='jb-bubble-ring' d={BUBBLE} />
          <path className='jb-bubble' d={BUBBLE} />
          {[8, 15, 22].map((x) => (
            <circle key={x} className='jb-bubble-dot' cx={x} cy='-14' r='2.4' />
          ))}
        </g>
      </g>
      <g data-jb='juggled'>
        {[0, 1, 2].map((i) => (
          <g key={i} style={{ display: 'none' }}>
            <Juggled i={i} />
          </g>
        ))}
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

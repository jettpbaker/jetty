import { pressHandlers } from '@/lib/press-handlers'
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react'

// Ransom-note wordmark: real torn-magazine cutout letters (Resource Boy pack,
// royalty-free), one scrap per letter with seeded jitter so it reads as taped
// down by hand. Click re-rolls every letter; scraps ease away from a nearby
// cursor. Inspired by rauno.me's open-sourced "Ransom note" vault piece.

import { RANSOM } from './ransom-manifest'

const spriteUrls = import.meta.glob('../assets/ransom/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function spriteUrl(file: string): string {
  return spriteUrls[`../assets/ransom/${file}.webp`] ?? ''
}

// mulberry32 — deterministic jitter so the wordmark is stable across visits
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Scrap = {
  letter: string
  file: string
  rot: number
  dy: number
  scale: number
  gap: number
  depth: number
  swapped?: boolean
}

// Default composition mirrors the reference collage; jitter is seeded on top.
const WORD: Array<{ letter: string; file: string }> = [
  { letter: 'J', file: 'J_03' },
  { letter: 'E', file: 'E_05' },
  { letter: 'T', file: 'T_05' },
  { letter: 'T', file: 'T_04' },
  { letter: 'Y', file: 'Y_03' },
]

// Warm the default composition at boot so even a cold-cache first visit to
// the draft page renders every scrap instantly.
for (const { file } of WORD) new Image().src = spriteUrl(file)

function composeWord(): Scrap[] {
  const rnd = mulberry32(0x4a455454) // 'JETT'
  const rndDepth = mulberry32(0x59) // separate stream so adding depth kept the layout
  return WORD.map(({ letter, file }) => ({
    letter,
    file,
    rot: (rnd() * 2 - 1) * 7,
    dy: (rnd() * 2 - 1) * 0.06,
    scale: 1 + (rnd() * 2 - 1) * 0.1,
    gap: rnd() * 0.05,
    depth: 0.6 + rndDepth() * 0.4,
  }))
}

// Every letter changes to a different cutout (twin Ts must never match).
function rollNext(current: Scrap[]): Scrap[] {
  const next: Scrap[] = []
  for (const scrap of current) {
    const taken = new Set(next.filter((s) => s.letter === scrap.letter).map((s) => s.file))
    const options = (RANSOM[scrap.letter] ?? []).filter(
      (v) => v.file !== scrap.file && !taken.has(v.file)
    )
    const pick = options[Math.floor(Math.random() * options.length)]
    next.push(pick ? { ...scrap, file: pick.file } : scrap)
  }
  return next
}

const ENTER_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const ENTER_MS = 460
const STAGGER_MS = 30

// Fisher-Yates: which stagger slot each letter pops in on, shuffled per mount
function shuffledSlots(n: number): number[] {
  const slots = Array.from({ length: n }, (_, i) => i)
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = slots[i]!
    slots[i] = slots[j]!
    slots[j] = tmp
  }
  return slots
}

const REPULSE_RADIUS = 150 // px of cursor influence around each scrap
const REPULSE_PUSH = 22 // max px a scrap gives way
const EASE_K = 0.14 // per-frame exponential approach toward the target
const LEAN_DEG_PER_PX = 0.25 // paper tips over as it slides
const LIFT_MAX = 0.035 // scale gain at full displacement — lifting off the page

// Inverse of the inspo's magnetism: each scrap eases AWAY from the pointer by
// its own proximity (a per-letter field, not a flat container tilt). The
// repulsion layer has no CSS transition — this loop eases every frame, and
// stops once everything settles; pointer movement kicks it back on.
function useRepulsion(hostRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const maybeHost = hostRef.current
    if (!maybeHost) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const host: HTMLDivElement = maybeHost

    const state = new Map<HTMLElement, { x: number; y: number }>()
    let pointer: { x: number; y: number } | null = null
    let raf = 0

    function tick() {
      raf = 0
      let settled = true
      for (const el of host.querySelectorAll<HTMLElement>('[data-scrap]')) {
        let s = state.get(el)
        if (!s) state.set(el, (s = { x: 0, y: 0 }))
        let tx = 0
        let ty = 0
        if (pointer) {
          const rect = el.getBoundingClientRect()
          // subtract the current offset so the field acts on the resting center
          const dx = rect.left + rect.width / 2 - s.x - pointer.x
          const dy = rect.top + rect.height / 2 - s.y - pointer.y
          const d = Math.hypot(dx, dy)
          if (d > 0 && d < REPULSE_RADIUS) {
            const fall = (1 - d / REPULSE_RADIUS) ** 2
            const depth = Number(el.dataset.depth ?? 1)
            tx = (dx / d) * REPULSE_PUSH * fall * depth
            ty = (dy / d) * REPULSE_PUSH * fall * depth
          }
        }
        s.x += (tx - s.x) * EASE_K
        s.y += (ty - s.y) * EASE_K
        if (Math.abs(tx - s.x) > 0.05 || Math.abs(ty - s.y) > 0.05) settled = false
        // lean and lift derive from the eased displacement, so they ride the
        // same spring and settle back to identity with it
        const lean = s.x * LEAN_DEG_PER_PX
        const lift = 1 + Math.min(Math.hypot(s.x, s.y) / REPULSE_PUSH, 1) * LIFT_MAX
        el.style.transform = `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px) rotate(${lean.toFixed(2)}deg) scale(${lift.toFixed(3)})`
      }
      if (!settled) raf = requestAnimationFrame(tick)
    }

    function kick() {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    function onMove(event: PointerEvent) {
      pointer = { x: event.clientX, y: event.clientY }
      kick()
    }
    function onLeave() {
      pointer = null
      kick()
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      cancelAnimationFrame(raf)
    }
  }, [hostRef])
}

type Phase = 'hidden' | 'shown'

// Static mini wordmark for chrome (tab bar): same composition and jitter as
// the draft-page wordmark, none of the motion — it's seen constantly. Uses
// dedicated pre-shrunk sprites: browser-downscaling the 220px scans ~11x
// turns them to mush on low-DPR displays.
const STATIC_SCRAPS = composeWord()

const miniUrls = import.meta.glob('../assets/ransom-mini/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>

export function RansomWordmarkStatic({
  lineH = 20,
  className = '',
}: {
  lineH?: number
  className?: string
}) {
  return (
    <div
      className={`flex select-none items-center ${className}`}
      style={{ gap: `${lineH * 0.12}px` }}
    >
      {STATIC_SCRAPS.map((scrap, i) => {
        const variant = RANSOM[scrap.letter]?.find((v) => v.file === scrap.file)
        if (!variant) return null
        return (
          <img
            key={i}
            src={miniUrls[`../assets/ransom-mini/${scrap.file}.webp`] ?? spriteUrl(scrap.file)}
            alt=''
            draggable={false}
            className='w-auto shrink-0'
            style={{
              height: `${lineH * scrap.scale}px`,
              transform: `translateY(${scrap.dy * lineH}px) rotate(${scrap.rot}deg)`,
            }}
          />
        )
      })}
    </div>
  )
}

export function RansomWordmark({ lineH = 112, className = '' }: { lineH?: number; className?: string }) {
  const [scraps, setScraps] = useState<Scrap[]>(composeWord)
  const [slots] = useState(() => shuffledSlots(WORD.length))
  const [phase, setPhase] = useState<Phase>(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'shown' : 'hidden'
  )
  const hostRef = useRef<HTMLDivElement>(null)
  useRepulsion(hostRef)

  useEffect(() => {
    if (phase !== 'hidden') return
    const raf = requestAnimationFrame(() => setPhase('shown'))
    return () => cancelAnimationFrame(raf)
  }, [phase])

  // The next composition is decided (and its images warmed) one roll AHEAD,
  // so a click swaps to already-cached cutouts — never a blank scrap.
  const [upcoming, setUpcoming] = useState<Scrap[]>(() => rollNext(composeWord()))

  useEffect(() => {
    for (const scrap of upcoming) {
      new Image().src = spriteUrl(scrap.file)
    }
  }, [upcoming])

  function reroll() {
    setScraps(upcoming.map((scrap) => ({ ...scrap, swapped: true })))
    setUpcoming(rollNext(upcoming))
  }

  return (
    <div
      ref={hostRef}
      className={`flex cursor-pointer select-none items-center justify-center ${className}`}
      style={{ gap: `${lineH * 0.18}px` }}
      {...pressHandlers(reroll)}
    >
      <span className='sr-only'>Jetty</span>
      {scraps.map((scrap, i) => {
        const variant = RANSOM[scrap.letter]?.find((v) => v.file === scrap.file)
        if (!variant) return null
        const h = lineH * scrap.scale
        const w = (variant.w / variant.h) * h
        // outer layer: layout + JS-eased repulsion (never CSS-transitioned)
        const scrapStyle: CSSProperties = {
          width: `${w}px`,
          height: `${h}px`,
          marginRight: `${scrap.gap * lineH}px`,
          willChange: 'transform',
          transition: 'width 260ms ease-out, height 260ms ease-out',
        }
        // inner layer: rest pose + entrance transition
        const delay = (slots[i] ?? i) * STAGGER_MS
        const poseStyle: CSSProperties =
          phase === 'shown'
            ? {
                transform: `translateY(${scrap.dy * lineH}px) rotate(${scrap.rot}deg)`,
                opacity: 1,
                filter: 'blur(0px)',
                transition: `transform ${ENTER_MS}ms ${ENTER_EASE} ${delay}ms, opacity ${Math.round(ENTER_MS * 0.7)}ms ease ${delay}ms, filter ${ENTER_MS}ms ease ${delay}ms`,
              }
            : {
                transform: `translateY(${lineH * 0.18}px) rotate(${scrap.rot * 1.25}deg) scale(0.96)`,
                opacity: 0,
                filter: 'blur(3px)',
                transition: 'none',
              }
        return (
          <span
            key={i}
            data-scrap
            data-depth={scrap.depth.toFixed(2)}
            className='relative shrink-0'
            style={scrapStyle}
          >
            <span className='absolute inset-0' style={poseStyle}>
              <img
                key={scrap.file}
                src={spriteUrl(scrap.file)}
                alt=''
                draggable={false}
                className={`absolute top-1/2 left-1/2 h-full w-auto max-w-none -translate-x-1/2 -translate-y-1/2 ${scrap.swapped ? 'ransom-swap-in' : ''}`}
              />
            </span>
          </span>
        )
      })}
    </div>
  )
}

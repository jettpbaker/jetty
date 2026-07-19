import { pressHandlers } from '@/lib/press-handlers'
import { type CSSProperties, useEffect, useState } from 'react'

// Ransom-note wordmark: real torn-magazine cutout letters (Resource Boy pack,
// royalty-free), one scrap per letter with seeded jitter so it reads as taped
// down by hand. Tapping a scrap swaps it for a different cutout of the same
// letter. Inspired by rauno.me's open-sourced "Ransom note" vault piece.

type Variant = { file: string; w: number; h: number }

const RANSOM: Record<string, Variant[]> = {
  J: [
    { file: 'J_03', w: 177, h: 220 },
    { file: 'J_06', w: 163, h: 220 },
    { file: 'J_09', w: 162, h: 220 },
    { file: 'J_13', w: 187, h: 220 },
    { file: 'J_17', w: 83, h: 220 },
  ],
  E: [
    { file: 'E_05', w: 181, h: 220 },
    { file: 'E_12', w: 147, h: 220 },
    { file: 'E_21', w: 220, h: 220 },
    { file: 'E_27', w: 190, h: 220 },
    { file: 'E_30', w: 139, h: 220 },
  ],
  T: [
    { file: 'T_04', w: 127, h: 220 },
    { file: 'T_05', w: 133, h: 220 },
    { file: 'T_07', w: 262, h: 220 },
    { file: 'T_13', w: 201, h: 220 },
    { file: 'T_16', w: 201, h: 220 },
    { file: 'T_23', w: 167, h: 220 },
  ],
  Y: [
    { file: 'Y_02', w: 129, h: 220 },
    { file: 'Y_03', w: 190, h: 220 },
    { file: 'Y_08', w: 225, h: 220 },
    { file: 'Y_13', w: 174, h: 220 },
    { file: 'Y_17', w: 249, h: 220 },
  ],
}

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

function composeWord(): Scrap[] {
  const rnd = mulberry32(0x4a455454) // 'JETT'
  return WORD.map(({ letter, file }) => ({
    letter,
    file,
    rot: (rnd() * 2 - 1) * 7,
    dy: (rnd() * 2 - 1) * 0.06,
    scale: 1 + (rnd() * 2 - 1) * 0.1,
    gap: rnd() * 0.05,
  }))
}

const ENTER_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const ENTER_MS = 460
const STAGGER_MS = 30

export function RansomWordmark({ lineH = 72, className = '' }: { lineH?: number; className?: string }) {
  const [scraps, setScraps] = useState<Scrap[]>(composeWord)
  const [revealed, setRevealed] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const raf = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Re-roll every letter to a different cutout (twin Ts must never match).
  function reroll() {
    setScraps((current) => {
      const next: Scrap[] = []
      for (const scrap of current) {
        const taken = new Set(next.filter((s) => s.letter === scrap.letter).map((s) => s.file))
        const options = (RANSOM[scrap.letter] ?? []).filter(
          (v) => v.file !== scrap.file && !taken.has(v.file)
        )
        const pick = options[Math.floor(Math.random() * options.length)]
        next.push(pick ? { ...scrap, file: pick.file, swapped: true } : scrap)
      }
      return next
    })
  }

  return (
    <div
      className={`flex cursor-pointer select-none items-center justify-center ${className}`}
      style={{ gap: `${lineH * 0.06}px` }}
      {...pressHandlers(reroll)}
    >
      <span className='sr-only'>Jetty</span>
      {scraps.map((scrap, i) => {
        const variant = RANSOM[scrap.letter]?.find((v) => v.file === scrap.file)
        if (!variant) return null
        const h = lineH * scrap.scale
        const w = (variant.w / variant.h) * h
        const style: CSSProperties = {
          width: `${w}px`,
          height: `${h}px`,
          marginRight: `${scrap.gap * lineH}px`,
          transform: revealed
            ? `translateY(${scrap.dy * lineH}px) rotate(${scrap.rot}deg)`
            : `translateY(${lineH * 0.18}px) rotate(${scrap.rot * 1.25}deg) scale(0.96)`,
          opacity: revealed ? 1 : 0,
          filter: revealed ? 'blur(0px)' : 'blur(3px)',
          transition: `transform ${ENTER_MS}ms ${ENTER_EASE} ${i * STAGGER_MS}ms, opacity ${Math.round(ENTER_MS * 0.7)}ms ease ${i * STAGGER_MS}ms, filter ${ENTER_MS}ms ease ${i * STAGGER_MS}ms, width 260ms ease-out, height 260ms ease-out`,
        }
        return (
          <span key={i} className='relative shrink-0' style={style}>
            <img
              key={scrap.file}
              src={spriteUrl(scrap.file)}
              alt=''
              draggable={false}
              className={`absolute top-1/2 left-1/2 h-full w-auto max-w-none -translate-x-1/2 -translate-y-1/2 ${scrap.swapped ? 'ransom-swap-in' : ''}`}
            />
          </span>
        )
      })}
    </div>
  )
}

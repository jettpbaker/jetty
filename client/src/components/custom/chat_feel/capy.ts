import type { Transition } from 'motion/react'

import { capyBlocks } from './capy_fade'
import { type StreamFeel } from './jetty'

// Capy's streaming, rebuilt from ~/code/scratch/teardowns/chat-capy.md. The store already applies
// deltas once a frame, so text shows as it lands: no pacing, and words may show half-written while
// their fade carries on (capy_fade.tsx).
export const stream: StreamFeel = {
  smoothBlocks: capyBlocks,
  wholeWords: (text) => text,
  pacing: { lump: Infinity, ms: 0, chars: Infinity, count: 1, steady: false },
}

// Capy's one curve: 150ms in, 120ms out. Under reduced motion a panel only fades, over 110ms.
export const capyEase = [0.23, 1, 0.32, 1] as const

export function capyMotion(open: boolean, reducedMotion: boolean | null): Transition {
  if (reducedMotion) return { duration: 0, opacity: { duration: 0.11, ease: 'linear' } }
  return { duration: open ? 0.15 : 0.12, ease: capyEase }
}

import { useEffect, useRef, useState } from 'react'

const TICK_MS = 24
// chars of backlog per extra word revealed each tick — smaller = faster catch-up
const STREAM_CATCH_UP = 160
const DRAIN_CATCH_UP = 40

function isSpace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r'
}

function nextBoundary(text: string, from: number): number {
  let i = from
  while (i < text.length && isSpace(text[i]!)) i += 1
  while (i < text.length && !isSpace(text[i]!)) i += 1
  return i
}

/**
 * Smooths a bursty streamed string into a steady word-by-word reveal
 * (opencode-style pacing). The visible edge trails the live text by an
 * adaptive amount: one word per tick plus proportional catch-up when a burst
 * puts it behind; once streaming ends the remainder drains fast instead of
 * snapping. Non-streaming mounts (history) show the full text immediately.
 */
export function usePacedText(text: string, streaming: boolean): string {
  const [visible, setVisible] = useState(() => (streaming ? 0 : text.length))
  const liveRef = useRef({ text, streaming })
  liveRef.current.text = text
  liveRef.current.streaming = streaming

  const behind = visible < text.length
  const active = streaming || behind

  useEffect(() => {
    if (!active) return
    let last = performance.now()
    let raf = 0
    function step(now: number) {
      const live = liveRef.current
      if (now - last >= TICK_MS) {
        last = now
        setVisible((current) => {
          if (current >= live.text.length) return current
          const backlog = live.text.length - current
          const catchUp = live.streaming
            ? Math.floor(backlog / STREAM_CATCH_UP)
            : Math.max(3, Math.floor(backlog / DRAIN_CATCH_UP))
          let next = nextBoundary(live.text, current)
          for (let i = 0; i < catchUp && next < live.text.length; i += 1) {
            next = nextBoundary(live.text, next)
          }
          return next
        })
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [active])

  return behind ? text.slice(0, visible) : text
}

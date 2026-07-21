import { useEffect, useState } from 'react'

const TICK_MS = 120

/**
 * Eases a displayed count toward a chunky upstream total (thinking-token
 * estimates arrive in ~200-token bursts every ~1.5s) so it reads as a
 * continuous climb. Steps proportionally to the remaining gap: fast when far
 * behind a fresh burst, slowing as it catches up.
 */
export function useSmoothCount(target: number): number {
  const [shown, setShown] = useState(0)
  const caughtUp = shown >= target

  useEffect(() => {
    if (caughtUp) return
    const id = setInterval(() => {
      setShown((s) => (s >= target ? s : s + Math.max(1, Math.round((target - s) / 10))))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [target, caughtUp])

  return Math.min(shown, target)
}

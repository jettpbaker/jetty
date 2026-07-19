import { useEffect, useState, type RefObject } from 'react'

const EDGE_THRESHOLD_PX = 1

export type ScrollEdges = { atTop: boolean; atBottom: boolean }

/**
 * Tracks whether a scroll container is currently flush against its top and/or
 * bottom edge. Re-measures on scroll and on size changes (content or viewport).
 *
 * When content fits and isn't scrollable, both `atTop` and `atBottom` are `true`.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ atTop: true, atBottom: true })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      const atTop = el.scrollTop <= EDGE_THRESHOLD_PX
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_THRESHOLD_PX
      setEdges((prev) =>
        prev.atTop === atTop && prev.atBottom === atBottom ? prev : { atTop, atBottom }
      )
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [ref])

  return edges
}

/**
 * Builds a `mask-image` value that fades the top and/or bottom of a scroll
 * container. An edge that is currently flush (atTop / atBottom) is left
 * un-faded so content sits crisply against it instead of being washed out.
 *
 * Returns `undefined` when both edges are flush (no scroll), so callers can
 * skip applying a mask entirely in that common case.
 */
export function buildScrollFadeMask({
  atTop,
  atBottom,
  topPx,
  bottomPx,
}: ScrollEdges & { topPx: number; bottomPx: number }): string | undefined {
  if (atTop && atBottom) return undefined
  const top = atTop ? 'black 0' : `transparent 0, black ${topPx}px`
  const bottom = atBottom ? 'black 100%' : `black calc(100% - ${bottomPx}px), transparent 100%`
  return `linear-gradient(to bottom, ${top}, ${bottom})`
}

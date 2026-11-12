import type { Virtualizer } from '@tanstack/react-virtual'

import { perf } from '@/perf'
import { useCallback, useEffect, useRef, type RefObject } from 'react'

// A chat sometimes lands blank, its messages a screen or more above, and it has never happened on
// demand. Until it's explained, a chat that draws nothing in its window for a second, or that the
// list had to pull back from past its end, writes what the list held and the scroll moves that led
// there to the field log, once per visit.

type Attributes = Record<string, number | string | boolean>

const kept = 200

export type ScrollTrail = ReturnType<typeof createScrollTrail>

export function createScrollTrail(element: () => HTMLElement | null) {
  const notes: [number, string, number, number][] = []
  return {
    note(what: string) {
      const scroller = element()
      notes.push([
        Math.round(performance.now()),
        what,
        Math.round(scroller?.scrollTop ?? -1),
        scroller?.scrollHeight ?? -1,
      ])
      if (notes.length > kept) notes.shift()
    },
    read: () => JSON.stringify(notes),
  }
}

export function useBlankCheck(
  scrollerRef: RefObject<HTMLElement | null>,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  trail: ScrollTrail,
  stateRef: RefObject<() => Attributes>
) {
  const reportedRef = useRef(false)
  const report = useCallback(
    (why: string) => {
      const element = scrollerRef.current
      if (reportedRef.current || !element) return
      reportedRef.current = true
      const items = virtualizer.getVirtualItems()
      const spacer = element.firstElementChild as HTMLElement
      const first = items[0]
      const last = items.at(-1)
      const internals = virtualizer as unknown as {
        scrollState: unknown
        _clampedAdjustment: unknown
      }
      perf.chatBlank({
        ...stateRef.current(),
        why,
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        spacer: spacer.style.height,
        spacerDrawn: spacer.offsetHeight,
        count: virtualizer.options.count,
        total: virtualizer.getTotalSize(),
        offset: virtualizer.scrollOffset ?? -1,
        drawn: first && last ? `${first.index}-${last.index} at ${first.start}-${last.end}` : '',
        pending: JSON.stringify(internals.scrollState ?? null),
        clamped: JSON.stringify(internals._clampedAdjustment ?? null),
        trail: trail.read(),
      })
    },
    [scrollerRef, virtualizer, trail, stateRef]
  )
  useEffect(() => {
    let since = Infinity
    const timer = setInterval(() => {
      const element = scrollerRef.current
      if (!element || virtualizer.options.count === 0) return
      const top = element.scrollTop
      const bottom = top + element.clientHeight
      const items = virtualizer.getVirtualItems()
      // A hidden tab stops the frames that would finish a glide.
      if (document.hidden || items.some((item) => item.end > top && item.start < bottom)) {
        since = Infinity
        return
      }
      since = Math.min(since, performance.now())
      if (performance.now() - since >= 1000) report('blank')
    }, 500)
    return () => clearInterval(timer)
  }, [scrollerRef, virtualizer, report])
  return report
}

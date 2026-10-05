import type { Virtualizer } from '@tanstack/react-virtual'

import { useEffect, type RefObject } from 'react'

import type { ThreadRow } from './thread_rows'

// Dev builds warn when the chat's rows sit at heights the page doesn't draw them at, which shows as
// blank space between or under rows, or rows overlapping. A row still animating changes between
// checks, so only a mismatch that holds still is reported.
export function useLayoutCheck(
  scroller: RefObject<HTMLElement | null>,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  rows: RefObject<readonly ThreadRow[]>,
  pinned: RefObject<boolean>
) {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let previous = ''
    let warned = ''
    const timer = setInterval(() => {
      const element = scroller.current
      if (!element?.firstElementChild) return
      const off: string[] = []
      for (const row of element.firstElementChild.children) {
        const index = Number((row as HTMLElement).dataset.index)
        const size = virtualizer.measurementsCache[index]?.size
        const height = (row as HTMLElement).offsetHeight
        if (size !== undefined && Math.abs(size - height) > 24)
          off.push(
            `${rows.current[index]?.kind} row ${index} is ${size}px in the list, ${height}px drawn`
          )
      }
      const mismatch = off.join('; ')
      if (mismatch && mismatch === previous && mismatch !== warned) {
        warned = mismatch
        console.warn(`Chat layout is off: ${mismatch}`, {
          scrollTop: element.scrollTop,
          behind: element.scrollHeight - element.clientHeight - element.scrollTop,
          total: virtualizer.getTotalSize(),
          pinned: pinned.current,
        })
      }
      previous = mismatch
    }, 1000)
    return () => clearInterval(timer)
  }, [scroller, virtualizer, rows, pinned])
}

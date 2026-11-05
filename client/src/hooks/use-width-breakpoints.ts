import { useLayoutEffect, type RefObject } from 'react'

// Matching size queries make Chrome relayout native textarea edits, even at a stable width.
export function useWidthBreakpoints(
  elementRef: RefObject<HTMLElement | null>,
  breakpoints: Readonly<Record<string, number>>
) {
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element) return
    let previousWidth: number | undefined
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const width = entry.contentRect.width
      if (width === previousWidth) return
      previousWidth = width
      for (const [name, threshold] of Object.entries(breakpoints))
        element.toggleAttribute(`data-${name}`, width < threshold)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [elementRef, breakpoints])
}

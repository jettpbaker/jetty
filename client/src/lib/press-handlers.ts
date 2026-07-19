import type { MouseEvent, PointerEvent } from 'react'

// Fires the pointer path immediately (act-on-press) while still activating from
// the keyboard, which arrives as a click with detail === 0.
// Primary button only — right/middle click must not select or navigate.
export function pressHandlers(run: () => void) {
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      run()
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (event.detail === 0) run()
    },
  }
}

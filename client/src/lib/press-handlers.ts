import type { MouseEvent } from 'react'

// Fires the pointer path immediately (act-on-press) while still activating from
// the keyboard, which arrives as a click with detail === 0.
export function pressHandlers(run: () => void) {
  return {
    onPointerDown: run,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (event.detail === 0) run()
    },
  }
}

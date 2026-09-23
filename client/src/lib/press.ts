import type { MouseEvent, PointerEvent } from 'react'

export function pressProps(action: () => void) {
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button === 0) action()
    },
    // Keyboard activation arrives as a click with detail 0.
    onClick: (event: MouseEvent) => {
      if (event.detail === 0) action()
    },
  }
}

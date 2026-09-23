import type { MouseEvent, PointerEvent } from 'react'

/** Act on pointer-down; keyboard activation (a click with `detail === 0`) still works. */
export function pressProps(action: () => void) {
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button === 0) action()
    },
    onClick: (event: MouseEvent) => {
      if (event.detail === 0) action()
    },
  }
}

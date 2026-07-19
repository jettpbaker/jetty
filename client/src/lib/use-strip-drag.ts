import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

// Drag-to-reorder for a horizontal strip of uniform, fixed-width items
// (tabs). The dragged item follows the pointer imperatively (no re-render per
// move); displaced siblings slide via shiftStyle; release glides the item
// into its slot before committing the reorder.
//
// Slots must be uniform: `step` is the px distance between adjacent item
// origins, and all slot math derives from it.

export type StripDragOptions = {
  count: number
  /** px between adjacent slot origins */
  step: number
  onReorder: (from: number, to: number) => void
  /** px of travel before a press becomes a drag (below it, press = click) */
  threshold?: number
  /** drop glide duration */
  settleMs?: number
  /** displaced-sibling slide duration */
  shiftMs?: number
}

export type StripDrag = {
  /** null when idle; live drag positions otherwise */
  drag: { from: number; to: number } | null
  /** spread onto each draggable item's element */
  handleProps: (index: number) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: () => void
    onPointerCancel: () => void
  }
  /** style for a NON-dragged item; undefined when no drag is live */
  shiftStyle: (index: number) => CSSProperties | undefined
}

export function useStripDrag(options: StripDragOptions): StripDrag {
  const [drag, setDragState] = useState<{ from: number; to: number } | null>(null)
  const dragRef = useRef(drag)
  const startRef = useRef<{ x: number; index: number; node: HTMLElement } | null>(null)
  const settleTimer = useRef<number | null>(null)
  // handlers close over this instead of the arguments, so window listeners
  // and timers always see current values
  const optionsRef = useRef(options)
  optionsRef.current = options

  function setDrag(next: { from: number; to: number } | null) {
    dragRef.current = next
    setDragState(next)
  }

  function release() {
    const start = startRef.current
    startRef.current = null
    if (!start) return
    const active = dragRef.current
    if (!active) return
    const { step, settleMs = 160, onReorder } = optionsRef.current
    const node = start.node
    // glide into the target slot, then commit the reorder
    node.style.transition = `transform ${settleMs}ms ease`
    node.style.transform = `translateX(${(active.to - active.from) * step}px)`
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null
      node.style.transition = ''
      node.style.transform = ''
      setDrag(null)
      onReorder(active.from, active.to)
    }, settleMs)
  }

  // The release can land anywhere — outside the strip, mid-flick, over other
  // elements. Window-level listeners during a drag guarantee we hear it.
  const releaseRef = useRef(release)
  releaseRef.current = release
  const dragActive = drag !== null
  useEffect(() => {
    if (!dragActive) return
    function onWindowRelease() {
      releaseRef.current()
    }
    window.addEventListener('pointerup', onWindowRelease)
    window.addEventListener('pointercancel', onWindowRelease)
    return () => {
      window.removeEventListener('pointerup', onWindowRelease)
      window.removeEventListener('pointercancel', onWindowRelease)
    }
  }, [dragActive])

  useEffect(
    () => () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
    },
    []
  )

  function handleProps(index: number) {
    return {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0 || settleTimer.current) return
        startRef.current = { x: event.clientX, index, node: event.currentTarget }
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const start = startRef.current
        if (!start) return
        const { count, step, threshold = 5 } = optionsRef.current
        const dx = event.clientX - start.x
        if (!dragRef.current) {
          if (Math.abs(dx) < threshold) return
          event.currentTarget.setPointerCapture(event.pointerId)
          setDrag({ from: start.index, to: start.index })
        }
        // travel is capped to the strip so the visual position always agrees
        // with the slot math
        const clamped = Math.min(
          (count - 1 - start.index) * step,
          Math.max(-start.index * step, dx)
        )
        start.node.style.transform = `translateX(${clamped}px)`
        const to = start.index + Math.round(clamped / step)
        if (dragRef.current && to !== dragRef.current.to) {
          setDrag({ from: start.index, to })
        }
      },
      onPointerUp() {
        releaseRef.current()
      },
      onPointerCancel() {
        releaseRef.current()
      },
    }
  }

  function shiftStyle(index: number): CSSProperties | undefined {
    if (!drag || index === drag.from) return undefined
    const { step, shiftMs = 150 } = optionsRef.current
    let shift = 0
    if (drag.from < drag.to && index > drag.from && index <= drag.to) shift = -step
    if (drag.from > drag.to && index >= drag.to && index < drag.from) shift = step
    return {
      transform: shift ? `translateX(${shift}px)` : undefined,
      transition: `transform ${shiftMs}ms ease`,
    }
  }

  return { drag, handleProps, shiftStyle }
}

import { useSidebar } from '@/components/ui/sidebar'
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

import './sidebar_resize_handle.css'

type Drag = { startX: number; startWidth: number; width: number; wrapper: HTMLElement }

const min = 200
const max = 300
const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)))

export function SidebarResizeHandle({
  width,
  onWidthChange,
}: {
  width: number
  onWidthChange: (width: number) => void
}) {
  const { open, isMobile } = useSidebar()
  const drag = useRef<Drag | null>(null)

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const wrapper = event.currentTarget.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')
    if (!wrapper) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    wrapper.dataset.resizing = 'true'
    drag.current = { startX: event.clientX, startWidth: width, width, wrapper }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) return
    current.width = clamp(current.startWidth + event.clientX - current.startX)
    current.wrapper.style.setProperty('--sidebar-width', `${current.width}px`)
    event.currentTarget.setAttribute('aria-valuenow', String(current.width))
  }

  function finish() {
    const current = drag.current
    if (!current) return
    delete current.wrapper.dataset.resizing
    drag.current = null
    onWidthChange(current.width)
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = { ArrowLeft: width - 10, ArrowRight: width + 10, Home: min, End: max }[event.key]
    if (next === undefined) return
    event.preventDefault()
    onWidthChange(clamp(next))
  }

  if (!open || isMobile) return null
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a focusable splitter; <hr> can't take focus or pointer handlers
      role='separator'
      aria-label='Resize sidebar'
      aria-orientation='vertical'
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className='sidebar-resize-handle'
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={keyDown}
    />
  )
}

import { useLayoutEffect, useRef, type RefObject } from 'react'

export function ScrollOverlay({
  viewport,
  controls,
}: {
  viewport: RefObject<HTMLDivElement | null>
  controls: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const metrics = useRef({ travel: 0, maximum: 0 })
  const drag = useRef<{ y: number; scroll: number } | null>(null)

  useLayoutEffect(() => {
    const scroller = viewport.current
    const rail = track.current
    const handle = thumb.current
    if (!scroller || !rail || !handle) return
    function update() {
      if (!scroller || !rail || !handle) return
      const height = rail.clientHeight
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const size = Math.min(
        height,
        Math.max(28, (height * scroller.clientHeight) / Math.max(1, scroller.scrollHeight))
      )
      const travel = height - size
      metrics.current = { travel, maximum }
      rail.style.visibility = maximum > 0 ? 'visible' : 'hidden'
      handle.style.height = `${size}px`
      handle.style.transform = `translateY(${maximum ? (scroller.scrollTop / maximum) * travel : 0}px)`
      handle.setAttribute('aria-valuemax', String(maximum))
      handle.setAttribute('aria-valuenow', String(Math.round(scroller.scrollTop)))
    }
    function wheel(event: WheelEvent) {
      if (!scroller) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? scroller.clientHeight : 1
      scroller.scrollTop += event.deltaY * unit
    }
    rail.addEventListener('wheel', wheel, { passive: false })
    const resize = new ResizeObserver(update)
    resize.observe(scroller)
    resize.observe(rail)
    let content: Element | null = null
    function observeContent() {
      if (!scroller) return
      if (content !== scroller.firstElementChild) {
        if (content) resize.unobserve(content)
        content = scroller.firstElementChild
        if (content) resize.observe(content)
      }
      update()
    }
    const mutation = new MutationObserver(observeContent)
    mutation.observe(scroller, { childList: true })
    scroller.addEventListener('scroll', update, { passive: true })
    observeContent()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      rail.removeEventListener('wheel', wheel)
      scroller.removeEventListener('scroll', update)
    }
  }, [viewport])

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- track clicks are a pointer shortcut; the thumb carries keyboard scrolling
    <div
      ref={track}
      className='diff-scroll-track'
      onClick={(event) => {
        if (event.target !== event.currentTarget || !viewport.current) return
        const { maximum } = metrics.current
        viewport.current.scrollTop =
          ((event.clientY - event.currentTarget.getBoundingClientRect().top) /
            event.currentTarget.clientHeight) *
          maximum
      }}
    >
      <div
        ref={thumb}
        className='diff-scroll-thumb'
        role='scrollbar'
        tabIndex={0}
        aria-label='Scroll diffs'
        aria-orientation='vertical'
        aria-controls={controls}
        aria-valuemin={0}
        aria-valuemax={0}
        aria-valuenow={0}
        onPointerDown={(event) => {
          if (event.button !== 0 || !viewport.current) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { y: event.clientY, scroll: viewport.current.scrollTop }
        }}
        onPointerMove={(event) => {
          if (!drag.current || !viewport.current) return
          const { travel, maximum } = metrics.current
          viewport.current.scrollTop =
            drag.current.scroll + ((event.clientY - drag.current.y) * maximum) / Math.max(1, travel)
        }}
        onPointerUp={(event) => {
          drag.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onKeyDown={(event) => {
          const scroller = viewport.current
          if (!scroller) return
          const offsets: Record<string, number> = {
            ArrowDown: 40,
            ArrowUp: -40,
            PageDown: scroller.clientHeight,
            PageUp: -scroller.clientHeight,
            Home: -scroller.scrollHeight,
            End: scroller.scrollHeight,
          }
          if (!(event.key in offsets)) return
          event.preventDefault()
          scroller.scrollTop += offsets[event.key]!
        }}
      />
    </div>
  )
}

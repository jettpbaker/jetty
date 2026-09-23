import { cn } from '@/lib/utils'
import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'

import './overflow_title.css'

export function OverflowTitle({
  children,
  className,
  focusable = true,
  renderText,
}: {
  children: string
  className?: string
  focusable?: boolean
  renderText?: (text: string) => ReactNode
}) {
  const viewport = useRef<HTMLSpanElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const [metrics, setMetrics] = useState({ overflow: false, width: 0 })
  const measured = useRef(metrics)
  useLayoutEffect(() => {
    const frame = viewport.current
    const label = text.current
    if (!frame || !label) return
    function measure() {
      if (!frame || !label) return
      const width = label.getBoundingClientRect().width
      const overflow = width > frame.getBoundingClientRect().width + 1
      if (measured.current.width === width && measured.current.overflow === overflow) return
      measured.current = { overflow, width }
      setMetrics(measured.current)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    observer.observe(label)
    measure()
    return () => observer.disconnect()
  }, [children])
  return (
    <span
      ref={viewport}
      className={cn(
        'overflow-title block min-w-0 flex-1 text-sm font-medium leading-snug',
        className
      )}
      data-overflow={metrics.overflow || undefined}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- an overflowing title scrolls; keyboard users need focus to scroll it
      tabIndex={focusable && metrics.overflow ? 0 : undefined}
      aria-label={children}
      style={
        {
          '--title-loop-distance': `${-(metrics.width + 16)}px`,
          '--title-duration': `${(metrics.width + 16) / 33}s`,
        } as CSSProperties
      }
    >
      <span className='overflow-title-track'>
        <span ref={text} className='overflow-title-text'>
          {renderText ? renderText(children) : children}
        </span>
        {metrics.overflow && (
          <span className='overflow-title-copy' aria-hidden='true'>
            {renderText ? renderText(children) : children}
          </span>
        )}
      </span>
    </span>
  )
}

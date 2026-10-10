import { hybridLabelHoldMs } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { RollingText } from './rolling_text'
import './opencode_text.css'

function common(oldText: string, newText: string) {
  const oldChars = Array.from(oldText)
  const newChars = Array.from(newText)
  let i = 0
  while (i < oldChars.length && i < newChars.length && oldChars[i] === newChars[i]) i++
  return i >= 2 && i < oldChars.length && i < newChars.length
    ? {
        prefix: oldChars.slice(0, i).join(''),
        old: oldChars.slice(i).join(''),
        next: newChars.slice(i).join(''),
      }
    : { prefix: '', old: oldText, next: newText }
}

export function OpencodeText({
  children,
  active,
  mono,
  shimmer,
  instant,
  onFinish,
  activeContent,
  count,
}: {
  children: string
  activeContent?: ReactNode
  count?: number
  active: boolean
  mono: boolean
  shimmer: boolean
  instant: boolean
  onFinish: () => void
}) {
  const value = children
  const [text, setText] = useState({ current: value, previous: undefined as string | undefined })
  const rootRef = useRef<HTMLSpanElement>(null)
  const slotRef = useRef<HTMLSpanElement>(null)
  const oldRef = useRef<HTMLSpanElement>(null)
  const nextRef = useRef<HTMLSpanElement>(null)
  if (value !== text.current) {
    setText({
      current: value,
      previous:
        !instant && value !== undefined && typeof text.current === 'string'
          ? text.current
          : undefined,
    })
  } else if (instant && text.previous !== undefined) {
    setText({ current: value, previous: undefined })
  }
  const split = useMemo(
    () =>
      text.previous !== undefined && typeof text.current === 'string'
        ? common(text.previous, text.current)
        : null,
    [text]
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    const slot = slotRef.current
    const old = oldRef.current
    const next = nextRef.current
    if (!split || !root || !slot || !old || !next || instant) {
      onFinish()
      return
    }
    root.dataset.ready = 'false'
    root.dataset.active = 'false'
    slot.style.width = `${Math.ceil(old.getBoundingClientRect().width)}px`
    // Both tails must paint in their initial states before the transitions start.
    void getComputedStyle(next).opacity
    root.dataset.ready = 'true'
    root.dataset.active = 'true'
    const frame = requestAnimationFrame(() => {
      slot.style.width = `${Math.ceil(next.getBoundingClientRect().width)}px`
    })
    const timer = setTimeout(() => {
      slot.style.width = ''
      root.dataset.ready = 'false'
      setText((current) => ({ ...current, previous: undefined }))
      onFinish()
    }, 600)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [text, split, active, mono, instant, onFinish])

  return (
    <span
      ref={rootRef}
      data-component='tool-status-title'
      data-ready='false'
      data-active='false'
      className={cn(mono && 'font-mono')}
      aria-label={count === undefined ? text.current : undefined}
    >
      {split?.prefix && (
        <span data-slot='tool-status-prefix' className={cn(shimmer && active && 'shimmer')}>
          <OpencodeContent count={count}>{split.prefix}</OpencodeContent>
        </span>
      )}
      <span ref={slotRef} data-slot='tool-status-swap'>
        {split && (
          <span ref={oldRef} data-slot='tool-status-active' aria-hidden='true'>
            <OpencodeContent count={count}>{split.old}</OpencodeContent>
          </span>
        )}
        <span
          ref={nextRef}
          data-slot='tool-status-done'
          className={cn(shimmer && active && 'shimmer')}
        >
          {active && activeContent !== undefined ? (
            activeContent
          ) : (
            <OpencodeContent count={count}>{split ? split.next : children}</OpencodeContent>
          )}
        </span>
      </span>
    </span>
  )
}

function OpencodeContent({ children, count }: { children: string; count?: number }) {
  if (count === undefined || !children.includes('{count}')) return children
  const [before, after] = children.split('{count}')
  return (
    <span className='inline-flex items-baseline'>
      <span className='whitespace-pre'>{before}</span>
      <RollingText quick holdMs={hybridLabelHoldMs} className='font-mono'>
        {String(count)}
      </RollingText>
      <span className='whitespace-pre'>{after}</span>
    </span>
  )
}

import { useFadeDuration } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import type { TurnLabel } from './projection'

import '../opencode_text.css'
import { RollingNumber } from '../rolling_number'

function template(label: TurnLabel) {
  return label.count === undefined ? label.text : label.text.replace(String(label.count), '{count}')
}

function common(oldText: string, nextText: string, countChanged: boolean) {
  let start = 0
  while (start < oldText.length && start < nextText.length && oldText[start] === nextText[start])
    start++
  const countAt = oldText.indexOf('{count}')
  if (countChanged && countAt >= 0 && start > countAt) start = countAt
  if (start < 2) start = 0
  let end = 0
  while (
    end < oldText.length - start &&
    end < nextText.length - start &&
    oldText[oldText.length - end - 1] === nextText[nextText.length - end - 1]
  )
    end++
  while (end > 0) {
    const oldAt = oldText.length - end
    const nextAt = nextText.length - end
    if (
      /\s/.test(oldText[oldAt]!) ||
      (oldAt > 0 &&
        nextAt > 0 &&
        /\s/.test(oldText[oldAt - 1]!) &&
        /\s/.test(nextText[nextAt - 1]!))
    )
      break
    end--
  }
  return { prefix: nextText.slice(0, start), suffix: end ? nextText.slice(-end) : '' }
}

function LabelPart({ text, label, instant }: { text: string; label: TurnLabel; instant: boolean }) {
  if (label.count !== undefined && text.includes('{count}')) {
    const [before, after] = text.split('{count}')
    return (
      <>
        {before}
        {instant ? (
          <span className='font-mono tabular-nums'>{label.count}</span>
        ) : (
          <RollingNumber value={label.count} className='font-mono' />
        )}
        {after}
      </>
    )
  }
  if (!label.mono) return text
  const target = text.indexOf(label.target)
  return target < 0 ? (
    text
  ) : (
    <>
      {text.slice(0, target)}
      <span className='font-mono'>{text.slice(target)}</span>
    </>
  )
}

export function TurnLabelText({
  label,
  shimmer,
  instant,
}: {
  label: TurnLabel
  shimmer: boolean
  instant: boolean
}) {
  const value = template(label)
  const [paint, setPaint] = useState({ value, label, previous: undefined as TurnLabel | undefined })
  if (value !== paint.value)
    setPaint({
      value,
      label,
      previous: instant ? undefined : { ...paint.label, text: paint.value },
    })
  else if (instant && paint.previous) setPaint({ value, label, previous: undefined })
  else if (label.count !== paint.label.count) setPaint({ ...paint, label })
  const rootRef = useRef<HTMLSpanElement>(null)
  const slotRef = useRef<HTMLSpanElement>(null)
  const oldRef = useRef<HTMLSpanElement>(null)
  const nextRef = useRef<HTMLSpanElement>(null)
  const sameWidth = useRef(false)
  const fade = Number(useFadeDuration())
  const previous = paint.previous?.text
  const { prefix, suffix } =
    previous === undefined
      ? { prefix: '', suffix: '' }
      : common(previous, value, paint.previous?.count !== label.count)
  const oldMiddle = previous?.slice(prefix.length, previous.length - suffix.length)
  useLayoutEffect(() => {
    const root = rootRef.current
    const slot = slotRef.current
    const old = oldRef.current
    const next = nextRef.current
    if (!root || !slot) return
    if (previous === undefined || !next || instant) {
      slot.style.width = ''
      root.dataset.ready = 'false'
      return
    }
    root.dataset.ready = 'false'
    root.dataset.active = 'false'
    const oldWidth = old ? Math.ceil(old.getBoundingClientRect().width) : 0
    const nextWidth = Math.ceil(next.getBoundingClientRect().width)
    sameWidth.current = oldWidth === nextWidth
    slot.style.width = `${oldWidth}px`
    void getComputedStyle(next).opacity
    root.dataset.ready = 'true'
    root.dataset.active = 'true'
    const frame = requestAnimationFrame(() => {
      slot.style.width = `${Math.ceil(next.getBoundingClientRect().width)}px`
    })
    return () => cancelAnimationFrame(frame)
  }, [previous, value, instant])
  function finish() {
    const slot = slotRef.current
    if (slot) slot.style.width = ''
    setPaint((current) => ({ ...current, previous: undefined }))
  }
  return (
    <span
      ref={rootRef}
      data-component='tool-status-title'
      className={cn(label.failed && 'text-status-error', shimmer && 'shimmer')}
      data-ready='false'
      data-active='false'
      data-v2-swap={previous !== undefined || undefined}
      data-swap-from={paint.previous?.text.replace('{count}', String(paint.previous.count))}
      data-swap-to={previous !== undefined ? label.text : undefined}
      aria-label={label.text}
      style={
        {
          '--v2-fade': `${fade}ms`,
          '--v2-lift': `${fade * 0.8}ms`,
          '--v2-width': `${fade * 2}ms`,
        } as CSSProperties
      }
    >
      {prefix && (
        <span data-slot='tool-status-prefix'>
          <LabelPart text={prefix} label={label} instant={instant} />
        </span>
      )}
      <span
        ref={slotRef}
        data-slot='tool-status-swap'
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === 'width') finish()
        }}
      >
        {paint.previous && oldMiddle && (
          <span ref={oldRef} data-slot='tool-status-active'>
            <LabelPart text={oldMiddle} label={paint.previous} instant={instant} />
          </span>
        )}
        <span
          ref={nextRef}
          data-slot='tool-status-done'
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === 'opacity' &&
              sameWidth.current
            )
              finish()
          }}
        >
          <LabelPart
            text={value.slice(prefix.length, value.length - suffix.length)}
            label={label}
            instant={instant}
          />
        </span>
      </span>
      {suffix && (
        <span data-slot='tool-status-suffix'>
          <LabelPart text={suffix} label={label} instant={instant} />
        </span>
      )}
    </span>
  )
}

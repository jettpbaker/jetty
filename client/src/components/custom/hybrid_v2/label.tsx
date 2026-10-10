import { useFadeDuration } from '@/lib/chat-feel'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import type { TurnLabel } from './projection'

import '../opencode_text.css'
import { PaintRoll } from './paint_roll'

function template(label: TurnLabel) {
  return label.count === undefined ? label.text : label.text.replace(String(label.count), '{count}')
}

function common(oldText: string, nextText: string) {
  const oldChars = Array.from(oldText)
  const nextChars = Array.from(nextText)
  let index = 0
  while (
    index < oldChars.length &&
    index < nextChars.length &&
    oldChars[index] === nextChars[index]
  )
    index++
  return index >= 2 && index < oldChars.length && index < nextChars.length
    ? oldChars.slice(0, index).join('')
    : ''
}

function LabelPart({ text, label, instant }: { text: string; label: TurnLabel; instant: boolean }) {
  if (label.count !== undefined && text.includes('{count}')) {
    const [before, after] = text.split('{count}')
    return (
      <>
        {before}
        <PaintRoll text={String(label.count)} quick instant={instant} />
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
  const prefix = previous === undefined ? '' : common(previous, value)
  useLayoutEffect(() => {
    const root = rootRef.current
    const slot = slotRef.current
    const old = oldRef.current
    const next = nextRef.current
    if (!root || !slot) return
    if (!old || !next || instant) {
      slot.style.width = ''
      root.dataset.ready = 'false'
      return
    }
    root.dataset.ready = 'false'
    root.dataset.active = 'false'
    const oldWidth = Math.ceil(old.getBoundingClientRect().width)
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
      className={label.failed ? 'text-status-error' : undefined}
      data-ready='false'
      data-active='false'
      data-v2-swap={previous !== undefined || undefined}
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
        <span data-slot='tool-status-prefix' className={shimmer ? 'shimmer' : undefined}>
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
        {paint.previous && (
          <span ref={oldRef} data-slot='tool-status-active' aria-hidden='true'>
            <LabelPart
              text={previous!.slice(prefix.length)}
              label={paint.previous}
              instant={instant}
            />
          </span>
        )}
        <span
          ref={nextRef}
          data-slot='tool-status-done'
          className={shimmer ? 'shimmer' : undefined}
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === 'opacity' &&
              sameWidth.current
            )
              finish()
          }}
        >
          <LabelPart text={value.slice(prefix.length)} label={label} instant={instant} />
        </span>
      </span>
    </span>
  )
}

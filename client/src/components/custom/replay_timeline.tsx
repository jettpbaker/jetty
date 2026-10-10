import type { ThreadEvent } from '@jetty/shared/events'

import { cn } from '@/lib/utils'
import { foldUpdate } from '@/state'
import { emptyThread } from '@jetty/shared/reducer'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const tracks = [
  { kind: 'user_message', label: 'User', color: 'var(--primary)' },
  { kind: 'reasoning', label: 'Thinking', color: 'var(--pr-merged)' },
  { kind: 'tool_call', label: 'Tools', color: 'var(--status-attention)' },
  { kind: 'assistant_message', label: 'Text', color: 'var(--status-success)' },
] as const

type ReplayEvent = { t: number; event: ThreadEvent }

function replayBlocks(events: ReplayEvent[], duration: number) {
  const spans = new Map<string, { start: number; end: number; open: boolean }>()
  let state = emptyThread
  for (const [index, { t, event }] of events.entries()) {
    state = foldUpdate(state, { type: 'event', seq: index + 1, ts: t, event })
    if (event.type === 'item.started')
      spans.set(event.item.id, { start: t, end: duration, open: true })
    if (event.type === 'item.completed') {
      const span = spans.get(event.itemId)
      if (span) {
        span.end = t
        span.open = false
      }
    }
  }
  return tracks.map((track) => ({
    ...track,
    blocks: state.items.flatMap((item) => {
      const span = spans.get(item.id)
      if (!span || item.kind !== track.kind) return []
      const label = item.kind === 'tool_call' ? item.toolName : 'text' in item ? item.text : ''
      return [{ id: item.id, label: label.trim() || track.label, ...span }]
    }),
  }))
}

function clockText(ms: number, precision = 1) {
  const seconds = ms / 1000
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(precision).padStart(precision ? precision + 3 : 2, '0')}`
}

function rulerStep(scale: number) {
  const target = 80 / scale
  const power = 10 ** Math.floor(Math.log10(target))
  return [1, 2, 5, 10].find((factor) => factor * power >= target)! * power
}

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(max, value))
}

export function ReplayTimeline({
  events,
  duration,
  elapsed,
  playing,
  onSeek,
}: {
  events: ReplayEvent[]
  duration: number
  elapsed: number
  playing: boolean
  onSeek: (at: number) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const seekFrame = useRef(0)
  const pending = useRef<number | null>(null)
  const [width, setWidth] = useState(1)
  const [view, setView] = useState({ start: 0, zoom: 1 })
  const lanes = useMemo(() => replayBlocks(events, duration), [events, duration])
  const fit = width / Math.max(1, duration)
  const scale = Math.min(Math.max(fit, 0.2), fit * view.zoom)
  const visible = width / scale
  const maxStart = Math.max(0, duration - visible)
  const start = clamp(view.start, maxStart)
  const step = rulerStep(scale)
  const ticks = []
  for (
    let t = Math.ceil(start / (step / 5)) * (step / 5);
    t <= Math.min(duration, start + visible);
    t += step / 5
  )
    ticks.push(t)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    function wheel(event: WheelEvent) {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1
      const delta = (event.deltaY || event.deltaX) * unit
      if (event.metaKey || event.ctrlKey) {
        const x = clamp(event.clientX - viewport!.getBoundingClientRect().left, width)
        const nextScale = Math.max(
          fit,
          Math.min(Math.max(fit, 0.2), scale * Math.exp(-delta * 0.005))
        )
        setView({
          zoom: nextScale / fit,
          start: clamp(
            start + x / scale - x / nextScale,
            Math.max(0, duration - width / nextScale)
          ),
        })
      } else {
        const pan =
          (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit
        setView((current) => ({ ...current, start: clamp(start + pan / scale, maxStart) }))
      }
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [duration, fit, maxStart, scale, start, width])

  useEffect(() => {
    if (playing && (elapsed < start || elapsed > start + visible))
      setView((current) => ({ ...current, start: clamp(elapsed - visible * 0.1, maxStart) }))
  }, [elapsed, playing, start, visible, maxStart])

  function showPlayhead(at: number) {
    const head = (at - start) * scale
    if (headRef.current) {
      headRef.current.style.transform = `translateX(${Math.min(head, width - 1)}px)`
      headRef.current.hidden = head < 0 || head > width
    }
    if (timeRef.current) timeRef.current.textContent = clockText(at)
    viewportRef.current?.setAttribute('aria-valuenow', String(at))
    viewportRef.current?.setAttribute('aria-valuetext', clockText(at, 3))
  }

  useLayoutEffect(() => {
    showPlayhead(pending.current ?? elapsed)
  })

  useEffect(() => () => cancelAnimationFrame(seekFrame.current), [])

  function scrub(clientX: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    const at = clamp(
      start + clamp(clientX - viewport.getBoundingClientRect().left, width) / scale,
      duration
    )
    pending.current = at
    showPlayhead(at)
    if (seekFrame.current) return
    seekFrame.current = requestAnimationFrame(() => {
      seekFrame.current = 0
      const at = pending.current!
      pending.current = null
      onSeek(at)
    })
  }

  const head = (elapsed - start) * scale
  return (
    <section
      aria-label='Replay timeline'
      className='flex shrink-0 cursor-default flex-col gap-2 px-3 pt-2 pb-3'
    >
      <div className='flex items-center justify-between gap-3 text-xs text-muted-foreground'>
        <span className='font-mono tabular-nums'>
          <span ref={timeRef}>{clockText(elapsed)}</span> / {clockText(duration)}
        </span>
        <span>← / → 100ms · Shift 1s · ⌘ / Ctrl + scroll to zoom · Scroll to pan</span>
      </div>
      <div className='flex overflow-hidden rounded-sm border bg-muted/20'>
        <div aria-hidden className='w-20 shrink-0 border-r text-xs text-muted-foreground'>
          <div className='h-7 border-b' />
          {tracks.map(({ label }) => (
            <div key={label} className='flex h-8 items-center border-b px-2 last:border-b-0'>
              {label}
            </div>
          ))}
        </div>
        <div
          ref={viewportRef}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native range input cannot contain the ruler and tracks
          role='slider'
          tabIndex={0}
          aria-label='Replay playhead'
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={elapsed}
          aria-valuetext={clockText(elapsed, 3)}
          className='relative min-w-0 flex-1 touch-none cursor-default overflow-hidden select-none outline-none'
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            scrub(event.clientX)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event.clientX)
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            const at =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? duration
                  : clamp(
                      elapsed +
                        (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1000 : 100),
                      duration
                    )
            onSeek(at)
            if (at < start || at > start + visible)
              setView((current) => ({ ...current, start: clamp(at - visible * 0.1, maxStart) }))
          }}
        >
          <div className='relative h-7 border-b bg-muted/40 font-mono text-[10px] text-muted-foreground'>
            {ticks.map((t) => {
              const major = Math.abs(t / step - Math.round(t / step)) < 0.001
              return (
                <div
                  key={t}
                  className={cn(
                    'absolute bottom-0 border-l border-border',
                    major ? 'h-full' : 'h-1.5'
                  )}
                  style={{ left: (t - start) * scale }}
                >
                  {major && (
                    <span className='absolute top-1 left-1 whitespace-nowrap'>
                      {clockText(t, step < 1000 ? 2 : 0)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {lanes.map(({ kind, color, blocks }) => (
            <div key={kind} className='relative h-8 border-b last:border-b-0'>
              {blocks.map((block) => {
                if (block.end < start || block.start > start + visible) return null
                const left = (Math.max(start, block.start) - start) * scale
                const blockWidth = Math.max(
                  2,
                  (Math.min(start + visible, block.end) - Math.max(start, block.start)) * scale
                )
                return (
                  <div
                    key={block.id}
                    title={`${block.label}\n${clockText(block.start, 3)} – ${clockText(block.end, 3)}${block.open ? ' (open through replay end)' : ''}`}
                    className='absolute top-1 flex h-6 items-center overflow-hidden rounded-sm border text-xs'
                    style={{
                      left,
                      width: blockWidth,
                      color,
                      borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
                      backgroundColor: `color-mix(in oklch, ${color} 18%, var(--background))`,
                    }}
                  >
                    {blockWidth >= 48 && (
                      <span className='truncate px-1.5'>
                        {block.label.replace(/\s+/g, ' ').split(' ').slice(0, 8).join(' ')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          <div
            ref={headRef}
            hidden={head < 0 || head > width}
            aria-hidden
            className='pointer-events-none absolute inset-y-0 left-0 w-px bg-primary'
            style={{ transform: `translateX(${Math.min(head, width - 1)}px)` }}
          >
            <div className='absolute top-0 left-1/2 h-3 w-2.5 -translate-x-1/2 rounded-b-sm bg-primary' />
          </div>
        </div>
      </div>
    </section>
  )
}

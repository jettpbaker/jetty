import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Lane, Span, Timeline } from './lanes'

import { createAxis, fitScale, segmentsFor, withNow } from './axis'

export const DEFAULT_SCALE = 0.02
const MIN_SCALE = 1e-7
const MAX_SCALE = 2
const GUTTER = 176
const LIVE_MARGIN = 72
const ROW_H = 22
const LANE_PAD = 4
const BOT_LANE_H = 36
const LABEL_MAX = 340
const CHIP_MAX = 220
const CHIP_KINDS = new Set(['bubble', 'note'])

export type View = { scale: number; left: number }
export type Selection = { id: string; from: 'timeline' | 'log' } | null

type Props = {
  timeline: Timeline
  now: number
  view: View
  following: boolean
  selection: Selection
  onView: (view: View, following: boolean) => void
  onSelect: (id: string | null) => void
}

function laneHeight(lane: Lane) {
  return lane.id === 'bot' ? BOT_LANE_H : lane.rows * ROW_H + LANE_PAD * 2
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function TimelineView({
  timeline,
  now,
  view,
  following,
  selection,
  onView,
  onSelect,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const dragged = useRef(false)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => setWidth(root.clientWidth - GUTTER))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const dataSegments = useMemo(() => segmentsFor(timeline.activity), [timeline.activity])
  const segments = withNow(dataSegments, now)
  const axis = createAxis(segments, view.scale)
  const left = following
    ? axis.x(now) - (width - LIVE_MARGIN)
    : clamp(view.left, -width / 2, axis.width - width / 2)
  const toX = (t: number) => axis.x(t) - left

  const byId = timeline.byId
  const latest = useRef({ axis, left, view, following, width, segments, now, byId })
  latest.current = { axis, left, view, following, width, segments, now, byId }

  function zoom(factor: number, anchor?: number) {
    const { axis, left, view, following, width, segments } = latest.current
    const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
    if (following) return onView({ scale, left }, true)
    const at = anchor ?? width / 2
    const t = axis.time(left + at)
    onView({ scale, left: createAxis(segments, scale).x(t) - at }, false)
  }

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    function onWheel(event: WheelEvent) {
      const { left, following } = latest.current
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const anchor = event.clientX - root!.getBoundingClientRect().left - GUTTER
        zoom(Math.exp(-event.deltaY * 0.01), following ? undefined : anchor)
        return
      }
      const dx = event.shiftKey ? event.deltaY : event.deltaX
      if (Math.abs(dx) <= Math.abs(event.shiftKey ? 0 : event.deltaY)) return
      event.preventDefault()
      onView({ scale: latest.current.view.scale, left: left + dx }, false)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  })

  useEffect(() => {
    if (selection?.from !== 'log') return
    const { axis, left, width, view, now, byId } = latest.current
    const span = byId.get(selection.id)
    if (!span) return
    const x0 = axis.x(span.start) - left
    const x1 = axis.x(span.end ?? now) - left
    if (x0 >= 0 && x1 <= width) return
    onView({ scale: view.scale, left: axis.x(span.start) - width / 3 }, false)
  }, [selection, onView])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    drag.current = { x: event.clientX, left, moved: false }
    dragged.current = false
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current
    if (!state) return
    const dx = event.clientX - state.x
    if (!state.moved && Math.abs(dx) < 4) return
    if (!state.moved) event.currentTarget.setPointerCapture(event.pointerId)
    state.moved = true
    onView({ scale: latest.current.view.scale, left: state.left - dx }, false)
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragged.current = !!drag.current?.moved
    if (drag.current && !dragged.current && event.target === event.currentTarget) onSelect(null)
    drag.current = null
  }

  const select = (id: string) => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    onSelect(id)
  }

  let y = 0
  const laneTops = new Map<string, number>()
  for (const lane of timeline.lanes) {
    laneTops.set(lane.id, y)
    y += laneHeight(lane)
  }
  const height = y
  const laneById = new Map(timeline.lanes.map((lane) => [lane.id, lane]))

  const selected = selection ? timeline.byId.get(selection.id) : undefined
  const related = new Set(selected?.links)

  const visible = timeline.spans.filter((span) => {
    const x0 = toX(span.start)
    const x1 = span.instant ? x0 + LABEL_MAX : toX(span.end ?? now)
    return x1 >= -8 && x0 <= width + 8
  })

  // A label outside its bar runs until the next thing in its row; a text chip also stops at a break.
  const labelRoom = new Map<string, number>()
  const breakXs = axis.breaks.map((gap) => gap.x - left)
  const rows = new Map<string, Span[]>()
  for (const span of visible) {
    const key = `${span.lane}:${span.parent ? 'inner' : span.row}`
    const row = rows.get(key) ?? []
    row.push(span)
    rows.set(key, row)
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.start - b.start)
    for (const [index, span] of row.entries()) {
      if (span.kind === 'turn') continue
      const x0 = toX(span.start)
      const next = row.slice(index + 1).find((other) => toX(other.start) > x0 + 1)
      const nextBreak = CHIP_KINDS.has(span.kind)
        ? (breakXs.find((x) => x > x0) ?? Infinity)
        : Infinity
      const room = Math.min(next ? toX(next.start) - x0 - 12 : LABEL_MAX, nextBreak - x0 - 6)
      labelRoom.set(span.id, clamp(room, 0, LABEL_MAX))
    }
  }

  const playhead = toX(now)

  return (
    <div className='timeline' ref={rootRef}>
      <div className='tl-head'>
        <div className='tl-controls' style={{ width: GUTTER }}>
          <button
            type='button'
            className='ghost'
            title='Zoom out (⌘ scroll)'
            onClick={() => zoom(1 / 1.6)}
          >
            −
          </button>
          <button
            type='button'
            className='ghost'
            title='Zoom in (⌘ scroll)'
            onClick={() => zoom(1.6)}
          >
            +
          </button>
          <button
            type='button'
            className='ghost'
            title='Fit everything'
            onClick={() =>
              onView({ scale: fitScale(segments, width - LIVE_MARGIN - 16), left: 0 }, true)
            }
          >
            Fit
          </button>
        </div>
        <div className='tl-axis'>
          {axis.breaks.map((gap) =>
            gap.x + gap.width < left || gap.x > left + width ? null : (
              <span
                key={gap.x}
                className='break-column'
                style={{ left: gap.x - left, width: gap.width }}
              />
            )
          )}
          {axis.labels(left, left + width).map((label) => (
            <span
              key={`${label.kind}:${label.x}`}
              className={label.kind === 'break' ? 'break-label' : 'tick'}
              style={{ left: label.left - left }}
              title={label.kind === 'break' ? `Idle ${label.text}` : undefined}
            >
              {label.text}
            </span>
          ))}
          <span className='playhead-head' style={{ left: playhead }} />
        </div>
      </div>
      <div className='tl-body'>
        <div className='tl-inner' style={{ height }}>
          <div className='tl-labels' style={{ width: GUTTER }}>
            {timeline.lanes.map((lane) => (
              <div
                key={lane.id}
                className='lane-label'
                data-worker={lane.worker || undefined}
                style={
                  {
                    top: laneTops.get(lane.id),
                    height: laneHeight(lane),
                    '--c': `var(--bot-${lane.color})`,
                  } as CSSProperties
                }
                title={lane.label}
              >
                <span className='dot' />
                <span className='lane-name'>{lane.label}</span>
              </div>
            ))}
          </div>
          <div
            className='tl-plot'
            style={{ left: GUTTER, width }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {timeline.lanes.map((lane) => (
              <div
                key={lane.id}
                className='lane-row'
                style={{ top: laneTops.get(lane.id), height: laneHeight(lane) }}
              />
            ))}
            {axis.breaks.map((gap) =>
              gap.x + gap.width < left || gap.x > left + width ? null : (
                <div
                  key={gap.x}
                  className='break'
                  style={{ left: gap.x - left, width: gap.width }}
                />
              )
            )}
            {timeline.links.map((link) => {
              const x = toX(link.at)
              const from = timeline.byId.get(link.from)
              const to = timeline.byId.get(link.to)
              if (!from || !to || x < 0 || x > width) return null
              const a = (laneTops.get(from.lane) ?? 0) + laneHeight(laneById.get(from.lane)!) / 2
              const b = (laneTops.get(to.lane) ?? 0) + laneHeight(laneById.get(to.lane)!) / 2
              const lit = selected && (selected.id === from.id || selected.id === to.id)
              return (
                <div
                  key={`${link.from}>${link.to}`}
                  className='guide'
                  data-lit={lit || undefined}
                  style={{ left: x, top: Math.min(a, b), height: Math.abs(b - a) }}
                />
              )
            })}
            {visible.map((span) => (
              <SpanView
                key={span.id}
                span={span}
                lane={laneById.get(span.lane)}
                top={laneTops.get(span.lane) ?? 0}
                x0={toX(span.start)}
                x1={span.end == null ? playhead : toX(span.end)}
                splitAt={span.visibleFrom == null ? undefined : toX(span.visibleFrom)}
                room={labelRoom.get(span.id) ?? LABEL_MAX}
                selected={span.id === selected?.id}
                related={related.has(span.id)}
                onSelect={select}
              />
            ))}
            <div className='playhead' style={{ left: playhead }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function SpanView({
  span,
  lane,
  top,
  x0,
  x1,
  splitAt,
  room,
  selected,
  related,
  onSelect,
}: {
  span: Span
  lane: Lane | undefined
  top: number
  x0: number
  x1: number
  splitAt: number | undefined
  room: number
  selected: boolean
  related: boolean
  onSelect: (id: string) => void
}) {
  const inner = !!span.parent
  const height = span.kind === 'turn' ? BOT_LANE_H - 8 : inner ? 18 : ROW_H - 4
  const rowTop =
    span.kind === 'turn' || inner
      ? top + (BOT_LANE_H - height) / 2
      : top + LANE_PAD + span.row * ROW_H + 2
  // Text blocks are often a few ms long; they borrow room up to the next thing so they read.
  // Other short bars keep their true width and put the label beside them.
  const bar = Math.max(x1 - x0, span.kind === 'turn' ? 4 : 3)
  const chip = CHIP_KINDS.has(span.kind)
  const floating =
    !span.instant && !chip && !inner && span.kind !== 'turn' && !span.quiet && bar < 32
  const width = chip ? Math.max(bar, Math.min(room, CHIP_MAX)) : bar
  const style: Record<string, string | number> = {
    '--c': span.failed ? 'var(--destructive)' : `var(--bot-${lane?.color ?? 'slate'})`,
    top: rowTop,
    height,
    ...(span.instant
      ? { left: x0 - (inner ? 0 : 4), maxWidth: room + (inner ? 0 : 12) }
      : floating
        ? { left: x0, maxWidth: bar + room, '--bar': `${bar}px` }
        : { left: x0, width }),
    ...(splitAt != null && {
      '--split': `${clamp(((splitAt - x0) / width) * 100, 0, 100)}%`,
    }),
  }
  return (
    <button
      type='button'
      className='span'
      data-kind={span.kind}
      data-instant={span.instant || undefined}
      data-floating={floating || undefined}
      data-inner={inner || undefined}
      data-private={span.private || undefined}
      data-split={splitAt != null || undefined}
      data-running={span.end == null || undefined}
      data-quiet={span.quiet || undefined}
      data-loud={span.loud || undefined}
      data-selected={selected || undefined}
      data-related={related || undefined}
      style={style as CSSProperties}
      title={`${span.actor} · ${span.tag ?? span.kind}\n${span.text}`}
      onClick={() => onSelect(span.id)}
    >
      {span.kind === 'turn' || span.quiet ? null : <span className='span-label'>{span.label}</span>}
    </button>
  )
}

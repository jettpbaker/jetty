import type { CSSProperties } from 'react'

import { memo, useEffect, useLayoutEffect, useRef } from 'react'

import type { Lane, Raw, Span, Timeline } from './lanes'
import type { Selection } from './timeline'
import type { ThreadRow } from './wire'

import { formatClock, formatDuration } from './format'

export const FILTERS = ['jett', 'wakes', 'bot', 'harness', 'tools', 'workers', 'quiet'] as const
export type Filter = (typeof FILTERS)[number]

export function filterOf(span: Span): Filter {
  return span.lane.startsWith('worker:') ? 'workers' : (span.lane as Filter)
}

type Props = {
  timeline: Timeline
  threads: Map<string, ThreadRow>
  selection: Selection
  expanded: Set<string>
  hidden: Set<Filter>
  following: boolean
  onToggleFilter: (filter: Filter) => void
  onSelect: (id: string) => void
  onPause: () => void
}

export function Log({
  timeline,
  threads,
  selection,
  expanded,
  hidden,
  following,
  onToggleFilter,
  onSelect,
  onPause,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const programmatic = useRef(false)
  const laneById = new Map(timeline.lanes.map((lane) => [lane.id, lane]))
  const rows = timeline.spans.filter(
    (span) => !hidden.has(filterOf(span)) && (!span.quiet || !hidden.has('quiet'))
  )

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!following || !scroll) return
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1) return
    programmatic.current = true
    scroll.scrollTop = scroll.scrollHeight
  })

  useEffect(() => {
    if (selection?.from !== 'timeline') return
    document.getElementById(`row-${selection.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [selection])

  function onScroll() {
    const scroll = scrollRef.current!
    if (programmatic.current) {
      programmatic.current = false
      return
    }
    if (following && scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 24) onPause()
  }

  const counts = new Map<Filter, number>()
  for (const span of timeline.spans) {
    const filter = span.quiet ? 'quiet' : filterOf(span)
    counts.set(filter, (counts.get(filter) ?? 0) + 1)
  }
  const unmapped = [...timeline.unmapped].map(([kind, count]) => `${kind} ×${count}`).join('\n')

  return (
    <section className='log'>
      <div className='log-bar'>
        <span className='log-title'>Call log</span>
        <div className='filters'>
          {FILTERS.map((filter) => {
            const lane =
              filter === 'workers' ? timeline.lanes.find((l) => l.worker) : laneById.get(filter)
            return (
              <button
                key={filter}
                type='button'
                className='chip'
                aria-pressed={!hidden.has(filter)}
                style={{ '--c': `var(--bot-${lane?.color ?? 'slate'})` } as CSSProperties}
                onClick={() => onToggleFilter(filter)}
              >
                {filter === 'quiet' ? null : <span className='dot' />}
                {filter === 'bot'
                  ? (lane?.label ?? 'Bot')
                  : filter[0]!.toUpperCase() + filter.slice(1)}
                <span className='chip-count'>{counts.get(filter) ?? 0}</span>
              </button>
            )
          })}
        </div>
        {unmapped && (
          <span className='unmapped' title={unmapped}>
            {timeline.unmapped.size} unmapped kinds
          </span>
        )}
      </div>
      <div className='log-rows' ref={scrollRef} onScroll={onScroll}>
        {rows.map((span) => (
          <Row
            key={span.id}
            span={span}
            end={span.end}
            rawCount={span.raw.length}
            lane={laneById.get(span.lane)}
            threads={threads}
            selected={selection?.id === span.id}
            expanded={expanded.has(span.id)}
            onSelect={onSelect}
          />
        ))}
        {rows.length === 0 && <div className='empty'>Nothing yet.</div>}
      </div>
    </section>
  )
}

type RowProps = {
  span: Span
  end: number | null
  rawCount: number
  lane: Lane | undefined
  threads: Map<string, ThreadRow>
  selected: boolean
  expanded: boolean
  onSelect: (id: string) => void
}

const Row = memo(
  function Row({ span, lane, threads, selected, expanded, onSelect }: RowProps) {
    const color = span.failed ? 'var(--destructive)' : `var(--bot-${lane?.color ?? 'slate'})`
    const duration = span.instant
      ? ''
      : span.end == null
        ? 'running'
        : formatDuration(span.end - span.start)
    return (
      <div
        className='row'
        id={`row-${span.id}`}
        data-selected={selected || undefined}
        data-inner={!!span.parent || undefined}
        data-quiet={span.quiet || undefined}
        data-loud={span.loud || undefined}
        style={{ '--c': color } as CSSProperties}
      >
        <button type='button' className='row-head' onClick={() => onSelect(span.id)}>
          <time>{formatClock(span.start, 'tenths')}</time>
          <span className='actor'>{span.actor}</span>
          <span className='text'>
            {span.tag && <span className='tag'>{span.tag}</span>}
            <span className='text-body'>{span.text}</span>
          </span>
          <span className='duration'>{duration}</span>
        </button>
        {expanded && <RowBody span={span} threads={threads} />}
      </div>
    )
  },
  (a, b) =>
    a.span.id === b.span.id &&
    a.end === b.end &&
    a.span.text === b.span.text &&
    a.rawCount === b.rawCount &&
    a.lane?.color === b.lane?.color &&
    a.selected === b.selected &&
    a.expanded === b.expanded
)

function RowBody({ span, threads }: { span: Span; threads: Map<string, ThreadRow> }) {
  const groups: Raw[][] = []
  for (const raw of span.raw) {
    const last = groups.at(-1)
    const delta = raw.kind === 'event' && raw.event.type === 'item.delta'
    const lastDelta = last?.[0]?.kind === 'event' && last[0].event.type === 'item.delta'
    if (delta && lastDelta) last!.push(raw)
    else groups.push([raw])
  }
  return (
    <div className='row-body'>
      {span.detail && <pre className='detail'>{span.detail}</pre>}
      {groups.map((group) => (
        <RawBlock key={rawKey(group[0]!)} group={group} threads={threads} />
      ))}
    </div>
  )
}

function rawKey(raw: Raw) {
  return raw.kind === 'event' ? `e:${raw.threadId}:${raw.seq}` : `t:${raw.file}:${raw.line}`
}

function RawBlock({ group, threads }: { group: Raw[]; threads: Map<string, ThreadRow> }) {
  const raw = group[0]!
  if (raw.kind === 'transcript') {
    const entry = raw.entry
    const subtype =
      (entry.attachment as { type?: string } | undefined)?.type ??
      (entry.subtype as string | undefined) ??
      (entry.operation as string | undefined)
    return (
      <div className='raw'>
        <div className='raw-head'>
          <span className='raw-source'>transcript</span>
          <span>
            {raw.file.slice(0, 8)}:{raw.line}
          </span>
          <span>{[entry.type, subtype].filter(Boolean).join(' · ')}</span>
          {entry.timestamp && <time>{formatClock(Date.parse(entry.timestamp), 'tenths')}</time>}
        </div>
        <pre>{JSON.stringify(entry, null, 2)}</pre>
      </div>
    )
  }
  const thread = threads.get(raw.threadId)
  const deltas = group.length > 1
  return (
    <div className='raw'>
      <div className='raw-head'>
        <span className='raw-source'>event</span>
        <span>{thread?.parentId ? thread.title : 'bot thread'}</span>
        <span>
          #{raw.seq}
          {deltas ? `–${(group.at(-1) as typeof raw).seq}` : ''}
        </span>
        <span>{deltas ? `item.delta × ${group.length}` : raw.event.type}</span>
        <time>{formatClock(raw.ts, 'tenths')}</time>
      </div>
      <pre>
        {group
          .map((item) =>
            item.kind === 'event'
              ? JSON.stringify(item.event, null, item.event.type === 'item.delta' ? undefined : 2)
              : ''
          )
          .join('\n')}
      </pre>
    </div>
  )
}

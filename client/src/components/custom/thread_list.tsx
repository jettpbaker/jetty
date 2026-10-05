import type { SessionStatus, TurnLoadout } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'
import type { TurnOutcome } from '@jetty/shared/reducer'

import { ChildReports, SubagentDone } from '@/components/custom/child_reports'
import { ErrorMessage } from '@/components/custom/error_message'
import { GalleryMessage } from '@/components/custom/gallery_message'
import { Markdown } from '@/components/custom/markdown'
import { MediaLightboxProvider } from '@/components/custom/media_lightbox'
import { AgentMessageFooter } from '@/components/custom/message_footer'
import { SubagentGroup } from '@/components/custom/subagent_group'
import { clearTextMeasure, estimateRow } from '@/components/custom/thread_measure'
import { ThreadMinimap, useTurns } from '@/components/custom/thread_minimap'
import {
  threadRows,
  toSubagent,
  type SubagentItem,
  type ThreadRow,
} from '@/components/custom/thread_rows'
import {
  CompactionSeam,
  RestartLimitSeam,
  RestartSeam,
  TranscriptMarker,
} from '@/components/custom/transcript_marker'
import { UserMessage } from '@/components/custom/user_message'
import { VideoMessage } from '@/components/custom/video_message'
import { WorkBlock } from '@/components/custom/work_block'
import { WorkflowGroup } from '@/components/custom/workflow_group'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'
import { useRevealRow } from '@/state'
import {
  measureElement,
  useVirtualizer,
  type Virtualizer,
  type VirtualItem,
} from '@tanstack/react-virtual'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

const pinSlack = 96
// Keeps a jumped-to message below the conversation's top blur.
const jumpClearance = 96
// A first open lays out this many window heights of rows exactly; the rest start rough.
const exactViewports = 3

// Where each conversation was left, so coming back to it restores the reading position.
// No anchor means it was at the bottom and should stay stuck there.
type ScrollPosition = {
  anchor?: { key: string; offset: number }
  sizes: VirtualItem[]
  width: number
}

// Least recently left first; only the most recent views keep their row sizes.
const positions = new Map<string, ScrollPosition>()
const keptPositions = 30

function savePosition(view: string, position: ScrollPosition) {
  positions.delete(view)
  positions.set(view, position)
  for (const oldest of positions.keys()) {
    if (positions.size <= keptPositions) break
    positions.delete(oldest)
  }
}

function anchorAt(virtualizer: Virtualizer<HTMLDivElement, Element>) {
  const offset = virtualizer.scrollOffset ?? 0
  const item = virtualizer.getVirtualItemForOffset(offset)
  return item && { key: String(item.key), offset: offset - item.start }
}

// Rows above where a first open lands, which start with rough estimates and are refined when idle.
function roughRows(rows: readonly ThreadRow[], width: number) {
  const ids = new Set<string>()
  let height = 0
  for (let index = rows.length - 1; index >= 0; index--) {
    if (height < exactViewports * window.innerHeight) height += estimateRow(rows[index]!, width)
    else ids.add(rows[index]!.id)
  }
  return ids
}

// Safari has no requestIdleCallback; a short timeout with a frame's budget stands in.
function whenIdle(callback: (until: number) => void) {
  if ('requestIdleCallback' in window)
    requestIdleCallback((deadline) => callback(performance.now() + deadline.timeRemaining()))
  else setTimeout(() => callback(performance.now() + 8), 16)
}

// Follows a pinned list down as it grows on a critically damped spring, so a line added mid-glide
// bends the motion instead of restarting it, and the chat never jumps a whole line at once.
function bottomGlide(element: HTMLElement, onWrite: (top: number) => void) {
  const stiffness = 20
  let frame = 0
  let velocity = 0
  let previous = 0
  let written = Number.NaN
  function tick(now: number) {
    const dt = Math.min(0.05, (now - previous) / 1000)
    previous = now
    const target = element.scrollHeight - element.clientHeight
    const offset = element.scrollTop - target
    const decay = Math.exp(-stiffness * dt)
    const next = (offset + (velocity + stiffness * offset) * dt) * decay
    velocity = (velocity - stiffness * (velocity + stiffness * offset) * dt) * decay
    const settled = Math.abs(next) < 0.5 && Math.abs(velocity) < 10
    element.scrollTop = settled ? target : target + next
    written = element.scrollTop
    onWrite(written)
    frame = settled ? 0 : requestAnimationFrame(tick)
    if (settled) velocity = 0
  }
  return {
    start() {
      if (frame) return
      previous = performance.now()
      frame = requestAnimationFrame(tick)
    },
    stop() {
      cancelAnimationFrame(frame)
      frame = 0
      velocity = 0
    },
    // Whether a scroll event is the glide's own.
    owns: (top: number) => Math.abs(top - written) < 1,
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

function contentWidth(scrollerWidth: number) {
  return Math.max(1, Math.min(708, scrollerWidth) - 48)
}

function rowStamp(row: ThreadRow) {
  switch (row.kind) {
    case 'assistant':
    case 'plan':
      return `${row.item.text.length}:${row.streaming}:${row.footer?.length ?? -1}`
    case 'user':
      return row.item.text.length
    case 'reports':
      return row.reports.map((report) => report.threadId).join(',')
    case 'subagentDone':
      return row.agent.status
    case 'error':
      return row.message.length
    case 'gallery':
      return `${row.item.images.length}:${row.item.caption?.length ?? 0}`
    case 'video':
      return row.item.caption?.length ?? 0
    case 'subagents':
      return row.agents.map((agent) => `${agent.id}:${agent.status}`).join(',')
    case 'workflow':
      return `${row.item.status}:${row.item.phases.length}:${row.item.agents.map((agent) => agent.state).join('')}`
    case 'compaction':
      return row.running
    case 'restart':
      return ''
    case 'restartLimit':
      return row.resumed
    case 'marker':
      return row.item.kind
    case 'work':
      return `${row.status}:${row.settingUp}:${row.activities
        .map((activity) =>
          activity.type === 'text'
            ? `${activity.id}:${activity.text.length}`
            : activity.type === 'thinking'
              ? `${activity.id}:${activity.summary.length}:${activity.status}`
              : activity.type === 'todo' || activity.type === 'created'
                ? activity.id
                : `${activity.id}:${activity.output?.length ?? 0}:${activity.status}`
        )
        .join(',')}`
  }
}

function SubagentsRow({
  agents,
  selectedId,
  onSelect,
}: {
  agents: readonly SubagentItem[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  const running = agents.some((agent) => agent.status === 'running')
  const now = useNow(1000, running)
  // Open while any run; closes itself once the last one finishes, and reopens if another starts.
  const [open, setOpen] = useState(running)
  const [wasRunning, setWasRunning] = useState(running)
  if (running !== wasRunning) {
    setWasRunning(running)
    setOpen(running)
  }
  return (
    <SubagentGroup
      agents={agents.map((agent) => toSubagent(agent, now))}
      open={open}
      onOpenChange={setOpen}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  )
}

// Rows keep their identity while unchanged, so a list re-render (scroll, measurement) skips them.
const ThreadItemRow = memo(function ThreadItemRow({
  row,
  threadId,
  selectedAgent,
  onSelectAgent,
  provider,
  projectPath,
}: {
  row: ThreadRow
  threadId: string
  selectedAgent?: string
  onSelectAgent: (id: string) => void
  provider?: string
  projectPath?: string
}) {
  if (row.kind === 'user')
    return (
      <UserMessage
        id={row.item.id}
        text={row.item.text}
        attachments={row.item.attachments}
        from={row.item.from}
        createdAt={row.item.createdAt}
      />
    )
  if (row.kind === 'reports') return <ChildReports reports={row.reports} />
  if (row.kind === 'assistant' || row.kind === 'plan')
    return (
      // Mid-run messages have no footer; with the list's 12px row gap, pb-1 makes a paragraph's gap.
      <Message align='start' className={cn(row.footer === undefined && 'pb-1')}>
        <MessageContent>
          <Bubble variant='ghost' align='start'>
            <BubbleContent>
              {row.kind === 'plan' && <p className='mb-1 text-xs text-muted-foreground'>Plan</p>}
              <Markdown streaming={row.streaming}>{row.item.text}</Markdown>
            </BubbleContent>
            {row.footer !== undefined && (
              <AgentMessageFooter
                text={row.footer}
                createdAt={row.item.createdAt}
                loadout={row.loadout}
                provider={provider}
              />
            )}
          </Bubble>
        </MessageContent>
      </Message>
    )
  if (row.kind === 'work')
    return (
      <WorkBlock
        threadId={threadId}
        activities={row.activities}
        status={row.status}
        startedAt={row.startedAt}
        elapsedSeconds={row.elapsedSeconds}
        settingUp={row.settingUp}
        restarted={row.restarted}
      />
    )
  if (row.kind === 'subagents')
    return <SubagentsRow agents={row.agents} selectedId={selectedAgent} onSelect={onSelectAgent} />
  if (row.kind === 'workflow') return <WorkflowGroup threadId={threadId} workflow={row.item} />
  if (row.kind === 'subagentDone')
    return <SubagentDone agent={row.agent} onSelect={onSelectAgent} />
  if (row.kind === 'compaction') return <CompactionSeam running={row.running} />
  if (row.kind === 'restart') return <RestartSeam />
  if (row.kind === 'restartLimit')
    return <RestartLimitSeam threadId={threadId} resumed={row.resumed} />
  if (row.kind === 'error') return <ErrorMessage message={row.message} />
  if (row.kind === 'gallery')
    return <GalleryMessage images={row.item.images} caption={row.item.caption} />
  if (row.kind === 'video')
    return <VideoMessage video={row.item.video} caption={row.item.caption} />
  return (
    <TranscriptMarker
      item={row.item}
      source={row.source}
      provider={provider}
      projectPath={projectPath}
    />
  )
})

export function ThreadList({
  threadId,
  items,
  status,
  running,
  outcomes,
  loadouts,
  projectPath,
  provider,
  agentId,
  settingUp,
  onSelectAgent,
}: {
  threadId: string
  items: readonly ThreadItem[]
  status: SessionStatus
  running: boolean
  outcomes?: Readonly<Record<string, TurnOutcome>>
  loadouts?: Readonly<Record<string, TurnLoadout>>
  projectPath?: string
  provider?: string
  agentId?: string
  settingUp?: boolean
  onSelectAgent: (id: string) => void
}) {
  const rows = useMemo(
    () =>
      threadRows(items, {
        status,
        running,
        outcomes,
        loadouts,
        projectPath,
        threadId,
        agentId,
        settingUp,
      }),
    [items, status, running, outcomes, loadouts, projectPath, threadId, agentId, settingUp]
  )
  const view = `${threadId}:${agentId ?? ''}`
  const [saved] = useState(() => {
    const position = positions.get(view)
    const index = rows.findIndex((row) => row.id === position?.anchor?.key)
    return position && { ...position, index }
  })
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(!saved || saved.index === -1)
  const [width, setWidth] = useState(saved?.width ?? 660)
  const [rough, setRough] = useState(() => (saved ? new Set<string>() : roughRows(rows, width)))
  const [gutter, setGutter] = useState(0)
  const [fontsReady, setFontsReady] = useState(false)

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => {
      const text = contentWidth(element.clientWidth)
      setWidth(text)
      setGutter((element.offsetWidth - text) / 2)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (document.fonts.status === 'loaded') return
    void document.fonts.ready.then(() => {
      clearTextMeasure()
      setFontsReady(true)
    })
  }, [])

  // A new key function makes the virtualizer re-estimate every unmeasured row, so it changes
  // only when an estimate can.
  const getItemKey = useCallback(
    (index: number) => rows[index]!.id,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- width, fontsReady and rough feed the estimates
    [rows, width, fontsReady, rough]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => estimateRow(rows[index]!, width, rough.has(rows[index]!.id)),
    overscan: 10,
    gap: 12,
    paddingStart: 24,
    paddingEnd: 24,
    getItemKey,
    initialMeasurementsCache: saved?.sizes,
    // The virtualizer keeps only measurements that differ from the estimate, so a row whose
    // estimate was exact would take its next estimate while its content is still animating in.
    measureElement: (element, entry, instance) => {
      const size = measureElement(element, entry, instance)
      const item = instance.measurementsCache[instance.indexFromElement(element)]
      if (item?.size === size) instance.itemSizeCache.set(item.key, size)
      return size
    },
    // A pinned thread mounts its bottom rows, not its top; the scroller is never taller than the window.
    initialOffset: (): number =>
      saved?.anchor && saved.index !== -1
        ? (virtualizer.measurementsCache[saved.index]?.start ?? 0) + saved.anchor.offset
        : Math.max(0, virtualizer.getTotalSize() - window.innerHeight),
  })

  useLayoutEffect(
    () => () => {
      savePosition(view, {
        anchor: pinned.current ? undefined : anchorAt(virtualizer),
        sizes: virtualizer.takeSnapshot(),
        width,
      })
    },
    [view, virtualizer, width]
  )

  const stamp = useMemo(() => rows.map(rowStamp).join('|'), [rows])
  // Rows also grow after render (highlighting, images, measurement), so re-pin on height too.
  const totalSize = virtualizer.getTotalSize()

  const glider = useRef<ReturnType<typeof bottomGlide>>(undefined)
  const landed = useRef({ key: '', at: 0 })
  const lastRow = useRef<{ key: unknown; start: number }>(undefined)
  // Where the list was last scrolled to, before any clamp from content that just shrank.
  const shownTop = useRef(0)
  useLayoutEffect(() => {
    if (!pinned.current || rows.length === 0 || !scroller.current) return
    // Growth glides; opening the thread, resizing it or seeking far lands at once.
    const key = `${view}:${width}`
    const last = virtualizer.measurementsCache[rows.length - 1]
    const anchor = lastRow.current
    lastRow.current = last && { key: last.key, start: last.start }
    const element = scroller.current
    const behind = element.scrollHeight - element.clientHeight - element.scrollTop
    const glides =
      !reducedMotion.matches &&
      behind < element.clientHeight &&
      landed.current.key === key &&
      performance.now() - landed.current.at > 300
    if (glides) {
      // Rows above the last changing size (a turn's Working line going) keep it where it is.
      if (last && anchor?.key === last.key && anchor.start !== last.start) {
        element.scrollTop = shownTop.current + last.start - anchor.start
        shownTop.current = element.scrollTop
      }
      glider.current ??= bottomGlide(element, (top) => (shownTop.current = top))
      glider.current.start()
      return
    }
    if (landed.current.key !== key) landed.current = { key, at: performance.now() }
    glider.current?.stop()
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [virtualizer, rows.length, stamp, width, totalSize, view])
  useEffect(() => () => glider.current?.stop(), [])

  const [revealId, clearReveal] = useRevealRow(threadId)
  useEffect(() => {
    if (!revealId || agentId) return
    const index = rows.findIndex((row) => row.id === revealId)
    if (index === -1) return
    clearReveal()
    pinned.current = false
    glider.current?.stop()
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [revealId, agentId, rows, virtualizer, clearReveal])

  const turns = useTurns(rows)
  const latestRows = useRef(rows)
  const latestWidth = useRef(width)
  useLayoutEffect(() => {
    latestRows.current = rows
    latestWidth.current = width
  })

  // Lays out the rough rows when idle, then swaps in their exact estimates in one commit, keeping
  // the top visible row in place. A list left early keeps refining, so a revisit finds them cached.
  const finishRefining = useRef<() => void>(undefined)
  useEffect(() => {
    if (rough.size === 0) return
    let index = 0
    let active = true
    function refine(until: number) {
      const rows = latestRows.current
      for (; index < rows.length && performance.now() < until; index++)
        if (rough.has(rows[index]!.id)) estimateRow(rows[index]!, latestWidth.current)
      return index === rows.length
    }
    function apply() {
      active = false
      finishRefining.current = undefined
      const rows = latestRows.current
      const width = latestWidth.current
      const top = virtualizer.getVirtualItemForOffset(virtualizer.scrollOffset ?? 0)?.index ?? 0
      let shift = 0
      for (const row of rows.slice(0, top))
        if (rough.has(row.id) && !virtualizer.itemSizeCache.has(row.id))
          shift += estimateRow(row, width) - estimateRow(row, width, true)
      // Moved before the commit, so it renders the rows that stay on screen.
      virtualizer.scrollOffset = (virtualizer.scrollOffset ?? 0) + shift
      flushSync(() => setRough(new Set()))
      if (shift && !pinned.current) virtualizer.scrollToOffset(virtualizer.scrollOffset)
    }
    function step(until: number) {
      if (!refine(until) || (active && virtualizer.isScrolling && !pinned.current))
        return whenIdle(step)
      if (active) apply()
    }
    finishRefining.current = () => {
      refine(Infinity)
      apply()
    }
    void document.fonts.ready.then(() => whenIdle(step))
    return () => {
      active = false
      finishRefining.current = undefined
    }
  }, [rough, virtualizer])

  const jumpTo = useCallback(
    (index: number) => {
      // A jump lands by estimate, so it needs the exact ones.
      finishRefining.current?.()
      const item = virtualizer.measurementsCache[index]
      if (!item) return
      pinned.current = false
      glider.current?.stop()
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      virtualizer.scrollToOffset(item.start - jumpClearance, {
        behavior: reduce ? 'auto' : 'smooth',
      })
    },
    [virtualizer]
  )

  return (
    <MediaLightboxProvider>
      <div data-perf-region='messages' className='relative flex min-h-0 flex-1 flex-col'>
        <section
          ref={scroller}
          className='scrollbar-subtle [scrollbar-gutter:stable_both-edges] min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none'
          aria-label='Conversation'
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the page does not scroll, so this scrollport has to be focusable
          tabIndex={0}
          onScroll={({ currentTarget: element }) => {
            shownTop.current = element.scrollTop
            if (glider.current?.owns(element.scrollTop)) return
            pinned.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < pinSlack
            if (!pinned.current) glider.current?.stop()
          }}
        >
          <div className='relative w-full' style={{ height: totalSize }}>
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className='absolute top-0 left-0 w-full'
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  className={cn(
                    'mx-auto w-full max-w-[708px] px-6',
                    rows[virtualRow.index]!.kind === 'user' && 'py-1.5'
                  )}
                >
                  <ThreadItemRow
                    row={rows[virtualRow.index]!}
                    threadId={threadId}
                    selectedAgent={agentId}
                    onSelectAgent={onSelectAgent}
                    provider={provider}
                    projectPath={projectPath}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <ThreadMinimap
          turns={turns}
          rows={latestRows}
          scroller={scroller}
          virtualizer={virtualizer}
          gutter={gutter}
          onSelect={jumpTo}
        />
      </div>
    </MediaLightboxProvider>
  )
}

import type { SessionStatus, TurnLoadout } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'
import type { TurnOutcome } from '@jetty/shared/reducer'

import { ChildReports, SubagentDone } from '@/components/custom/child_reports'
import { ErrorMessage } from '@/components/custom/error_message'
import { GalleryMessage } from '@/components/custom/gallery_message'
import { Markdown } from '@/components/custom/markdown'
import { MediaLightboxProvider } from '@/components/custom/media_lightbox'
import { AgentMessageFooter } from '@/components/custom/message_footer'
import {
  QueuedBubble,
  QueueRemoved,
  QueueSeam,
  useTranscriptQueue,
} from '@/components/custom/queued_messages'
import { SubagentGroup } from '@/components/custom/subagent_group'
import { useLayoutCheck } from '@/components/custom/thread_list_check'
import { clearTextMeasure, estimateRow, estimatesChanged } from '@/components/custom/thread_measure'
import { ThreadMinimap, useTurns } from '@/components/custom/thread_minimap'
import {
  createThreadRows,
  toSubagent,
  type SubagentItem,
  type ThreadRow,
} from '@/components/custom/thread_rows'
import {
  CompactionSeam,
  PullRequestSeam,
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
import { whenIdle } from '@/lib/preload'
import { cn } from '@/lib/utils'
import { completedAgo, useRevealRow } from '@/state'
import {
  measureElement,
  useVirtualizer,
  type Virtualizer,
  type VirtualItem,
} from '@tanstack/react-virtual'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

const pinSlack = 96
const rowGap = 12
// Keeps a jumped-to message below the conversation's top blur.
const jumpClearance = 96
// A first open lays out this many window heights of rows exactly; the rest start rough.
const exactViewports = 3
// Rough rows laid out per idle callback: a count, not a deadline, so the work splits the same way
// every time.
const refineBatch = 50

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

// Follows a pinned list down as it grows on a critically damped spring, so a line added mid-glide
// bends the motion instead of restarting it, and the chat never jumps a whole line at once.
function bottomGlide(
  element: HTMLElement,
  onWrite: (top: number) => void,
  onRun: (running: boolean) => void
) {
  const stiffness = 20
  let frame = 0
  let velocity = 0
  let previous = 0
  function tick(now: number) {
    const dt = Math.min(0.05, (now - previous) / 1000)
    previous = now
    const target = element.scrollHeight - element.clientHeight
    const offset = element.scrollTop - target
    const decay = Math.exp(-stiffness * dt)
    const next = (offset + (velocity + stiffness * offset) * dt) * decay
    velocity = (velocity - stiffness * (velocity + stiffness * offset) * dt) * decay
    // scrollTop snaps to whole pixels, so the spring can stall a pixel short of the bottom.
    const settled = Math.abs(offset) <= 1 && Math.abs(velocity) < 10
    write(settled ? target : target + next)
    frame = settled ? 0 : requestAnimationFrame(tick)
    if (!settled) return
    velocity = 0
    onRun(false)
  }
  function write(top: number) {
    element.scrollTop = top
    onWrite(element.scrollTop)
  }
  return {
    write,
    start() {
      if (frame) return
      previous = performance.now()
      frame = requestAnimationFrame(tick)
      onRun(true)
    },
    stop() {
      if (!frame) return
      cancelAnimationFrame(frame)
      frame = 0
      velocity = 0
      onRun(false)
    },
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

// Messages keep a little air either side.
const paddedRows = new Set<ThreadRow['kind']>(['user', 'queued', 'queueRemoved'])

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
    case 'queued':
      return `${row.entry.text.length}:${row.editing}`
    case 'queueSeam':
      return `${row.state}:${row.count}`
    case 'queueRemoved':
      return ''
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
    case 'pullRequest':
      return row.item.activity.length
    case 'restart':
    case 'backgroundStopped':
      return ''
    case 'restartLimit':
      return row.resumed
    case 'marker':
      return row.item.kind
    case 'work':
      return `${row.status}:${row.settingUp}:${row.activities
        .map((activity) =>
          activity.type === 'thinking'
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
        steered={row.steered}
        steering={row.steering}
      />
    )
  if (row.kind === 'queued')
    return (
      <QueuedBubble threadId={threadId} entry={row.entry} editing={row.editing} steer={row.steer} />
    )
  if (row.kind === 'queueSeam')
    return (
      <QueueSeam
        threadId={threadId}
        state={row.state}
        count={row.count}
        waiting={row.waiting}
        resume={row.resume}
      />
    )
  if (row.kind === 'queueRemoved') return <QueueRemoved threadId={threadId} />
  if (row.kind === 'reports') return <ChildReports reports={row.reports} />
  if (row.kind === 'assistant' || row.kind === 'plan')
    return (
      // Mid-run messages have no footer; with the list's 12px row gap, pb-1 makes a paragraph's gap.
      <Message align='start' className={cn(row.footer === undefined && 'pb-1')}>
        <MessageContent>
          <Bubble variant='ghost' align='start'>
            <BubbleContent>
              {row.kind === 'plan' && <p className='mb-1 text-xs text-muted-foreground'>Plan</p>}
              <Markdown
                streaming={row.streaming}
                // Claude often sends a reply written after a tool call all at once.
                arrived={!row.streaming && completedAgo(row.item.id) < 1000}
                reply={row.item.id}
              >
                {row.item.text}
              </Markdown>
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
  if (row.kind === 'pullRequest') return <PullRequestSeam item={row.item} />
  if (row.kind === 'restart') return <RestartSeam />
  if (row.kind === 'backgroundStopped')
    return <RestartSeam label='Background work stopped when Jetty restarted' />
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
  const queue = useTranscriptQueue(agentId ? undefined : threadId, items)
  const [buildRows] = useState(createThreadRows)
  const rows = useMemo(
    () =>
      buildRows(items, {
        status,
        running,
        outcomes,
        loadouts,
        projectPath,
        threadId,
        agentId,
        settingUp,
        queue,
      }),
    [
      buildRows,
      items,
      status,
      running,
      outcomes,
      loadouts,
      projectPath,
      threadId,
      agentId,
      settingUp,
      queue,
    ]
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
    if (document.fonts.status === 'loaded') return
    void document.fonts.ready.then(() => {
      clearTextMeasure()
      setFontsReady(true)
    })
  }, [])

  // A new key function makes the virtualizer re-estimate every unmeasured row, so it changes only
  // when an estimate can: a streamed delta leaves the rows' estimates as they were.
  const estimated = useRef(rows)
  if (rows !== estimated.current && estimatesChanged(estimated.current, rows))
    estimated.current = rows
  const estimatedRows = estimated.current
  const { getItemKey, estimateSize } = useMemo(
    () => ({
      getItemKey: (index: number) => estimatedRows[index]!.id,
      estimateSize: (index: number) =>
        estimateRow(estimatedRows[index]!, width, rough.has(estimatedRows[index]!.id)),
    }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- fontsReady changes text layout
    [estimatedRows, width, fontsReady, rough]
  )

  // A row the ResizeObserver sees change size (a block easing shut, sizes saved when the thread was
  // left) would otherwise be drawn at its old place for a frame, until the virtualizer's own
  // re-render lands after the paint. Its callbacks run before the paint, so the list redraws there,
  // once for all the rows that changed.
  const [, redraw] = useReducer((count: number) => count + 1, 0)
  const redrawQueued = useRef(false)
  function redrawBeforePaint() {
    if (redrawQueued.current) return
    redrawQueued.current = true
    queueMicrotask(() => {
      redrawQueued.current = false
      flushSync(redraw)
    })
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize,
    overscan: 10,
    gap: rowGap,
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
      else if (entry) redrawBeforePaint()
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

  const latestRows = useRef(rows)

  const stamp = useMemo(() => rows.map(rowStamp).join('|'), [rows])
  // Rows also grow after render (highlighting, images, measurement), so re-pin on height too.
  const totalSize = virtualizer.getTotalSize()

  const glider = useRef<ReturnType<typeof bottomGlide>>(undefined)
  const landed = useRef({ key: '', at: 0 })
  const lastRow = useRef<{ key: unknown; start: number }>(undefined)
  // Where the list was last scrolled to, before any clamp from content that just shrank.
  const shownTop = useRef(0)
  // When the reader last scrolled with the wheel, a touch or a key, and whether a pointer is down
  // (the scrollbar, a selection).
  const byHand = useRef({ at: -Infinity, held: false })
  useEffect(() => {
    const element = scroller.current!
    const scrolled = () => void (byHand.current.at = performance.now())
    const press = () => void (byHand.current.held = true)
    const release = () => void (byHand.current.held = false)
    const options = { passive: true }
    element.addEventListener('wheel', scrolled, options)
    element.addEventListener('touchmove', scrolled, options)
    element.addEventListener('keydown', scrolled)
    element.addEventListener('pointerdown', press)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      element.removeEventListener('wheel', scrolled)
      element.removeEventListener('touchmove', scrolled)
      element.removeEventListener('keydown', scrolled)
      element.removeEventListener('pointerdown', press)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [])
  const pin = useCallback((value: boolean) => {
    pinned.current = value
    if (!value) glider.current?.stop()
  }, [])
  // The browser's End and Home aim at the ends of rows still at their estimated sizes, so they
  // land short once those rows measure (639px in a 200-turn thread). Keys aimed at something
  // focused inside the chat (a scrolling tool output) stay its own.
  useEffect(() => {
    const element = scroller.current!
    const jump = (event: KeyboardEvent) => {
      if (event.target !== element || event.altKey || event.ctrlKey || event.shiftKey) return
      const meta = event.metaKey
      if ((event.key === 'End' && !meta) || (event.key === 'ArrowDown' && meta)) {
        event.preventDefault()
        pin(true)
        virtualizer.scrollToIndex(latestRows.current.length - 1, { align: 'end' })
      } else if ((event.key === 'Home' && !meta) || (event.key === 'ArrowUp' && meta)) {
        event.preventDefault()
        pin(false)
        virtualizer.scrollToOffset(0)
      }
    }
    element.addEventListener('keydown', jump)
    return () => element.removeEventListener('keydown', jump)
  }, [pin, virtualizer])
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
      // While it glides, the list keeps its own scroll position: the virtualizer would hold rows
      // that resize above the fold in place from an offset a gliding frame stale, dragging it up.
      glider.current ??= bottomGlide(
        element,
        (top) => (shownTop.current = top),
        (running) =>
          (virtualizer.shouldAdjustScrollPositionOnItemSizeChange = running
            ? () => false
            : undefined)
      )
      // Rows above the last changing size (a turn's Working line going) keep it where it is.
      if (last && anchor?.key === last.key && anchor.start !== last.start)
        glider.current.write(shownTop.current + last.start - anchor.start)
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
    pin(false)
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [revealId, agentId, rows, virtualizer, clearReveal, pin])

  const turns = useTurns(rows)
  const latestWidth = useRef(width)
  useLayoutEffect(() => {
    latestRows.current = rows
    latestWidth.current = width
  })
  useLayoutCheck(scroller, virtualizer, latestRows, pinned)

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    let height = element.clientHeight
    const measure = () => {
      const text = contentWidth(element.clientWidth)
      // Sizes measured at another width are wrong now; rows on screen measure again as they reflow.
      if (text !== latestWidth.current)
        for (const key of virtualizer.itemSizeCache.keys())
          if (!virtualizer.elementsCache.get(key)?.isConnected)
            virtualizer.itemSizeCache.delete(key)
      setWidth(text)
      setGutter((element.offsetWidth - text) / 2)
      // A pinned list keeps its bottom in view as the window or the composer takes height from it.
      if (pinned.current && element.clientHeight < height)
        element.scrollTop += height - element.clientHeight
      height = element.clientHeight
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [virtualizer])

  // Lays out the rough rows when idle, then swaps in their exact estimates in one commit, keeping
  // the top visible row in place. A list left early keeps refining, so a revisit finds them cached.
  const finishRefining = useRef<() => void>(undefined)
  useEffect(() => {
    if (rough.size === 0) return
    let index = 0
    let active = true
    function refine(count: number) {
      const rows = latestRows.current
      for (let done = 0; index < rows.length && done < count; index++)
        if (rough.has(rows[index]!.id)) {
          estimateRow(rows[index]!, latestWidth.current)
          done++
        }
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
    function step() {
      if (!refine(refineBatch) || (active && virtualizer.isScrolling && !pinned.current))
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
      pin(false)
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      virtualizer.scrollToOffset(item.start - jumpClearance, {
        behavior: reduce ? 'auto' : 'smooth',
      })
    },
    [virtualizer, pin]
  )

  return (
    <MediaLightboxProvider>
      <div data-perf-region='messages' className='relative flex min-h-0 flex-1 flex-col'>
        <section
          ref={scroller}
          className='scrollbar-subtle [scrollbar-gutter:stable_both-edges] min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
          aria-label='Conversation'
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the page does not scroll, so this scrollport has to be focusable
          tabIndex={0}
          onScroll={({ currentTarget: element }) => {
            // Only the reader's own scroll up lets go. The browser moves the list up too, clamping
            // it to content that shrank for a layout, and the glide can trail the bottom.
            const up = element.scrollTop < shownTop.current - 1
            const hand = byHand.current.held || performance.now() - byHand.current.at < 500
            const behind = element.scrollHeight - element.clientHeight - element.scrollTop
            shownTop.current = element.scrollTop
            // A clamp that keeps the list on its bottom (a taller window) isn't letting go.
            if (up && hand && behind >= 1) pin(false)
            // Coming back down near the bottom holds on, as does landing right on it; the
            // virtualizer holding a reader's place as a row above grows doesn't.
            else if (behind < (hand && !up ? pinSlack : 1)) pin(true)
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
                    paddedRows.has(rows[virtualRow.index]!.kind) && 'py-1.5'
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

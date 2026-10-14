import type { SessionStatus, TurnLoadout } from '@jetty/shared/events'
import type { ThreadSummary, ThreadHistory } from '@jetty/shared/history'
import type { ThreadItem } from '@jetty/shared/items'
import type { TurnOutcome } from '@jetty/shared/reducer'

import { AddToPrompt } from '@/components/custom/add_to_prompt'
import { ExchangeLine, type Room } from '@/components/custom/bot_conversation'
import { ThreadMarkers, TidyingLine, WakeMarker } from '@/components/custom/bot_markers'
import { ChildReports, SubagentDone } from '@/components/custom/child_reports'
import { ErrorMessage } from '@/components/custom/error_message'
import { ProjectFileRoot } from '@/components/custom/file_link'
import { GalleryMessage } from '@/components/custom/gallery_message'
import { Markdown } from '@/components/custom/markdown'
import { MediaLightboxProvider } from '@/components/custom/media_lightbox'
import { AgentMessageFooter } from '@/components/custom/message_footer'
import { ScrollToBottom } from '@/components/custom/scroll_to_bottom'
import { useLayoutCheck } from '@/components/custom/thread_list_check'
import { clearTextMeasure, estimateRow, estimatesChanged } from '@/components/custom/thread_measure'
import { ThreadMinimap, useTurns } from '@/components/custom/thread_minimap'
import { createThreadRows, type BotRows, type ThreadRow } from '@/components/custom/thread_rows'
import {
  BackgroundSeam,
  CompactionSeam,
  PullRequestSeam,
  PullRequestGroupSeam,
  RestartLimitSeam,
  RestartSeam,
} from '@/components/custom/transcript_marker'
import { UserMessage } from '@/components/custom/user_message'
import { VideoMessage } from '@/components/custom/video_message'
import { WorkBlock } from '@/components/custom/work_block'
import { WorkflowGroup } from '@/components/custom/workflow_group'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { bottomGlide } from '@/lib/bottom-glide'
import { whenIdle } from '@/lib/preload'
import { getSendMotionTransition } from '@/lib/send-motion'
import { cn } from '@/lib/utils'
import { chatComposer, completedAgo, useRevealRow } from '@/state'
import { useHistory } from '@/state/threads'
import { pendingTurnId } from '@/state/turns'
import {
  measureElement,
  useVirtualizer,
  type Virtualizer,
  type VirtualItem,
} from '@tanstack/react-virtual'
import { animate } from 'motion/react'
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
const chatInset = 24
// A sent message anchors this far below the top: just the row gap, so the row above is out of view.
const sentInset = rowGap
// A subagent's transcript sits right under the prompt row above it.
const agentInset = 4
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
  sentMessageId?: string
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

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

// Messages keep a little air either side.
const paddedRows = new Set<ThreadRow['kind']>(['user'])

function contentWidth(scrollerWidth: number) {
  return Math.max(1, Math.min(873, scrollerWidth) - 48)
}

function messagesBelow(
  indices: readonly number[],
  measurements: readonly VirtualItem[],
  edge: number
) {
  let start = 0
  let end = indices.length
  while (start < end) {
    const middle = (start + end) >>> 1
    if (measurements[indices[middle]!]!.end <= edge + 1) start = middle + 1
    else end = middle
  }
  return indices.length - start
}

function rowContains(row: ThreadRow, id: string, item?: ThreadItem) {
  if (row.id === id) return true
  if (row.kind === 'work')
    return row.activities.some((activity) => activity.id === id) || row.turnId === item?.turnId
  if (row.kind === 'markers') return row.markers.some((marker) => marker.id === id)
  if (row.kind === 'exchange') return row.entries.some((entry) => entry.id === id)
  if (item?.kind === 'pull_request') {
    const pulls =
      row.kind === 'pullRequestGroup' ? row.items : row.kind === 'pullRequest' ? [row.item] : []
    return pulls.some((pull) => pull.repo === item.repo && pull.number === item.number)
  }
  return false
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
    case 'wake':
      return `${row.wake}:${row.reports?.map((report) => report.threadId).join(',')}`
    case 'exchange':
      return row.entries.length
    case 'markers':
      return row.markers.length
    case 'tidying':
      return ''
    case 'subagentDone':
      return row.agent.status
    case 'error':
      return row.message.length
    case 'gallery':
      return `${row.item.images.length}:${row.item.caption?.length ?? 0}`
    case 'video':
      return row.item.caption?.length ?? 0
    case 'workflow':
      return `${row.item.status}:${row.item.phases.length}:${row.item.agents.map((agent) => agent.state).join('')}`
    case 'compaction':
      return `${row.state}:${row.reason ?? ''}`
    case 'pullRequest':
      return row.item.activity.length
    case 'pullRequestGroup':
      return row.items
        .map((item) => `${item.repo}#${item.number}:${item.activity.length}`)
        .join(',')
    case 'restart':
    case 'backgroundStopped':
      return ''
    case 'background':
      return row.item.endedAt !== undefined
    case 'restartLimit':
      return row.resumed
    case 'work':
      return `${row.status}:${row.settingUp}:${row.activities
        .map((activity) =>
          activity.type === 'text'
            ? `${activity.id}:${activity.text.length}:${activity.streaming}`
            : activity.type === 'thinking'
              ? `${activity.id}:${activity.summary.length}:${activity.status}`
              : activity.type === 'subagent'
                ? `${activity.id}:${activity.status}:${activity.waiting}`
                : activity.type === 'todo' ||
                    activity.type === 'created' ||
                    activity.type === 'question' ||
                    activity.type === 'approval'
                  ? activity.id
                  : `${activity.id}:${activity.output?.length ?? 0}:${activity.status}`
        )
        .join(',')}`
  }
}

// Rows keep their identity while unchanged, so a list re-render (scroll, measurement) skips them.
const ThreadItemRow = memo(function ThreadItemRow({
  row,
  threadId,
  provider,
  projectPath,
  onOpenRoom,
}: {
  row: ThreadRow
  threadId: string
  provider?: string
  projectPath?: string
  onOpenRoom?: (room: Room) => void
}) {
  if (row.kind === 'user')
    return (
      <UserMessage
        id={row.item.id}
        threadId={threadId}
        text={row.item.text}
        skill={row.item.skill}
        replies={row.item.replies}
        attachments={row.item.attachments}
        from={row.item.from}
        createdAt={row.item.createdAt}
        steered={row.steered}
        steering={row.steering}
      />
    )
  if (row.kind === 'reports') return <ChildReports reports={row.reports} />
  if (row.kind === 'wake') return <WakeMarker reports={row.reports} wake={row.wake} />
  if (row.kind === 'markers') return <ThreadMarkers botId={threadId} markers={row.markers} />
  if (row.kind === 'tidying') return <TidyingLine />
  if (row.kind === 'exchange' && onOpenRoom)
    return <ExchangeLine chatBotId={threadId} entries={row.entries} onOpen={onOpenRoom} />
  if (row.kind === 'assistant' || row.kind === 'plan')
    return (
      // Mid-run messages have no footer; with the list's 12px row gap, pb-1 makes a paragraph's gap.
      <Message align='start' className={cn(row.footer === undefined && 'pb-1')}>
        <MessageContent>
          <Bubble variant='ghost' align='start'>
            <BubbleContent data-quote={row.item.id}>
              {row.kind === 'plan' && <p className='mb-1 text-xs text-muted-foreground'>Plan</p>}
              <Markdown
                className='thread-reply text-13 leading-relaxed'
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
      <ProjectFileRoot value={projectPath}>
        <WorkBlock
          threadId={threadId}
          activities={row.activities}
          status={row.status}
          startedAt={row.startedAt}
          elapsedSeconds={row.elapsedSeconds}
          settingUp={row.settingUp}
          restarted={row.restarted}
        />
      </ProjectFileRoot>
    )
  if (row.kind === 'workflow') return <WorkflowGroup threadId={threadId} workflow={row.item} />
  if (row.kind === 'subagentDone') return <SubagentDone threadId={threadId} agent={row.agent} />
  if (row.kind === 'compaction') return <CompactionSeam state={row.state} reason={row.reason} />
  if (row.kind === 'pullRequest') return <PullRequestSeam item={row.item} />
  if (row.kind === 'pullRequestGroup') return <PullRequestGroupSeam items={row.items} />
  if (row.kind === 'restart') return <RestartSeam />
  if (row.kind === 'background') return <BackgroundSeam item={row.item} />
  if (row.kind === 'backgroundStopped')
    return <RestartSeam label='Background work stopped when Jetty restarted' />
  if (row.kind === 'restartLimit')
    return <RestartLimitSeam threadId={threadId} resumed={row.resumed} />
  if (row.kind === 'error')
    return <ErrorMessage message={row.message} threadId={threadId} turnId={row.turnId} />
  if (row.kind === 'gallery')
    return <GalleryMessage images={row.item.images} caption={row.item.caption} />
  if (row.kind === 'video')
    return <VideoMessage video={row.item.video} caption={row.item.caption} />
  return null
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
  bot,
  onOpenRoom,
  history,
  summary,
}: {
  threadId: string
  history?: ThreadHistory
  summary?: ThreadSummary
  items: readonly ThreadItem[]
  status: SessionStatus
  running: boolean
  outcomes?: Readonly<Record<string, TurnOutcome>>
  loadouts?: Readonly<Record<string, TurnLoadout>>
  projectPath?: string
  provider?: string
  agentId?: string
  settingUp?: boolean
  // A bot's chat: its other bots, and whether check-ins and tidies show.
  bot?: BotRows
  onOpenRoom?: (room: Room) => void
}) {
  const [revealedTurn, setRevealedTurn] = useState<string>()
  const rowBot = useMemo(
    () => (bot && revealedTurn ? { ...bot, revealedTurn } : bot),
    [bot, revealedTurn]
  )
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
        bot: rowBot,
        history,
        summary,
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
      rowBot,
      history,
      summary,
    ]
  )
  const historyActions = useHistory(threadId)
  const view = `${threadId}:${agentId ?? ''}`
  const messageIndices = useMemo(
    () =>
      rows.flatMap((row, index) =>
        row.kind === 'assistant' || row.kind === 'plan' ? [index] : []
      ),
    [rows]
  )
  const latestMessageIndices = useRef(messageIndices)
  const [saved] = useState(() => {
    const position = positions.get(view)
    const index = rows.findIndex((row) => row.id === position?.anchor?.key)
    return position && { ...position, index }
  })
  const lastUser = agentId
    ? undefined
    : rows.findLast(
        (row): row is Extract<ThreadRow, { kind: 'user' }> =>
          row.kind === 'user' && !row.item.from && !row.item.wake
      )
  const pending = lastUser?.item.turnId === pendingTurnId
  const [send, setSend] = useState(() => ({
    latest: lastUser?.id,
    anchor: pending ? lastUser.id : saved?.sentMessageId,
  }))
  if (lastUser?.id !== send.latest)
    setSend({
      latest: lastUser?.id,
      anchor:
        lastUser && (pending || !send.latest || rows.some((row) => row.id === send.latest))
          ? lastUser.id
          : undefined,
    })
  const sentAnchor = useRef(send.anchor)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(pending || !saved || saved.index === -1)
  const [viewportHeight, setViewportHeight] = useState(0)
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

  const previousVirtualizer = useRef<Virtualizer<HTMLDivElement, Element>>(undefined)
  const previousFirst = useRef(rows[0]?.id)
  const previousCount = useRef(rows.length)
  const movedStart = previousFirst.current !== rows[0]?.id || previousCount.current !== rows.length
  const readingAnchor =
    movedStart && previousVirtualizer.current && !pinned.current
      ? anchorAt(previousVirtualizer.current)
      : undefined

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize,
    overscan: 10,
    gap: rowGap,
    paddingStart: agentId ? agentInset : chatInset,
    paddingEnd: chatInset,
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

  const exactAnchor = readingAnchor ? rows.findIndex((row) => row.id === readingAnchor.key) : -1
  const anchorItem =
    readingAnchor && exactAnchor === -1
      ? items.find((item) => item.id === readingAnchor.key)
      : undefined
  const anchorIndex =
    exactAnchor !== -1
      ? exactAnchor
      : readingAnchor
        ? rows.findIndex((row) => rowContains(row, readingAnchor.key, anchorItem))
        : -1
  const prependTop =
    anchorIndex === -1
      ? undefined
      : (virtualizer.measurementsCache[anchorIndex]?.start ?? 0) + readingAnchor!.offset
  if (prependTop !== undefined) virtualizer.scrollOffset = prependTop
  useLayoutEffect(() => {
    previousVirtualizer.current = virtualizer
    previousFirst.current = rows[0]?.id
    previousCount.current = rows.length
    if (prependTop !== undefined && scroller.current) {
      scroller.current.scrollTop = prependTop
      shownTop.current = scroller.current.scrollTop
    }
    if (movedStart && pinned.current) landed.current.key = ''
  })

  useLayoutEffect(
    () => () => {
      savePosition(view, {
        anchor: pinned.current ? undefined : anchorAt(virtualizer),
        sentMessageId: sentAnchor.current,
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
  const sentIndex = send.anchor ? rows.findIndex((row) => row.id === send.anchor) : -1
  const sentStart = virtualizer.measurementsCache[sentIndex]?.start
  // The previous answer stays in view above the sent message: from its top when that leaves the
  // message in the window's top half, else as much of its end as fits there.
  const answerIndex = rows.findLastIndex(
    (row, index) => index < sentIndex && row.kind === 'assistant'
  )
  const answerStart = virtualizer.measurementsCache[answerIndex]?.start ?? sentStart
  const pinStart =
    sentStart === undefined || answerStart === undefined
      ? undefined
      : Math.max(answerStart, sentStart - viewportHeight / 2)
  // The reply consumes this space before its growth needs to move the conversation.
  const scrollSize =
    pinStart === undefined ? totalSize : Math.max(totalSize, pinStart - sentInset + viewportHeight)
  // Keep room for the spring to brake when finishing work shrinks the transcript.
  const [scrollSpace, setScrollSpace] = useState(scrollSize)
  if (scrollSize > scrollSpace) setScrollSpace(scrollSize)
  const scrollExtent = useRef(scrollSize)
  const releaseScrollSpace = useCallback(() => setScrollSpace(scrollExtent.current), [])
  const reserved = useRef(false)

  const glider = useRef<ReturnType<typeof bottomGlide>>(undefined)
  const following = useRef(false)
  const sendGlide = useRef<ReturnType<typeof animate>>(undefined)
  const sendPending = useRef(false)
  const sendInterrupted = useRef(false)
  const sendTarget = useRef(0)
  const stopSendGlide = useCallback(() => {
    sendPending.current = false
    if (!sendGlide.current) return
    sendGlide.current.stop()
    sendGlide.current = undefined
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
    releaseScrollSpace()
  }, [virtualizer, releaseScrollSpace])
  const landed = useRef({ key: '', at: 0 })
  const lastRow = useRef<{ key: unknown; start: number }>(undefined)
  // Where the list was last scrolled to, before any clamp from content that just shrank.
  const shownTop = useRef(0)
  // When the reader last scrolled with the wheel, a touch or a key, and whether a pointer is down
  // (the scrollbar, a selection).
  const byHand = useRef({ at: -Infinity, held: false })
  useEffect(() => {
    const element = scroller.current!
    const scrolled = () => {
      byHand.current.at = performance.now()
      if (!sendGlide.current) {
        sendInterrupted.current = false
        return
      }
      stopSendGlide()
      sendInterrupted.current = true
      pinned.current = false
    }
    const press = () => {
      byHand.current.held = true
      if (sendGlide.current) scrolled()
    }
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
  }, [stopSendGlide])
  const [fresh, setFresh] = useState(false)
  const [remainingMessages, setRemainingMessages] = useState(0)
  const checkMessages = useCallback(
    (element: HTMLElement) => {
      setRemainingMessages(
        messagesBelow(
          latestMessageIndices.current,
          virtualizer.measurementsCache,
          element.scrollTop + element.clientHeight
        )
      )
    },
    [virtualizer]
  )
  const pin = useCallback(
    (value: boolean) => {
      pinned.current = value
      if (value) {
        sendInterrupted.current = false
        setFresh(false)
      } else {
        glider.current?.stop()
        stopSendGlide()
      }
    },
    [stopSendGlide]
  )
  useLayoutEffect(() => {
    scrollExtent.current = scrollSize
    reserved.current = scrollSize > totalSize
    if (sentAnchor.current !== send.anchor && send.anchor) {
      pin(true)
      glider.current?.stop()
      stopSendGlide()
      sendPending.current = true
      landed.current.key = ''
    }
    sentAnchor.current = send.anchor
  }, [send.anchor, scrollSize, totalSize, pin, stopSendGlide])
  // While it glides, the list keeps its own scroll position: the virtualizer would hold rows that
  // resize above the fold in place from an offset a gliding frame stale, dragging it up.
  const gliderFor = useCallback(
    (element: HTMLElement) => {
      if (!glider.current)
        glider.current = bottomGlide(element, {
          target: () => sendTarget.current,
          onWrite: (top) => (shownTop.current = top),
          onRun: (running) => {
            following.current = running
            virtualizer.shouldAdjustScrollPositionOnItemSizeChange = running
              ? () => false
              : undefined
            if (!running) releaseScrollSpace()
          },
        })
      return glider.current
    },
    [virtualizer, releaseScrollSpace]
  )
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
        if (!history || history.ranges[0]?.start === 0) virtualizer.scrollToOffset(0)
        else
          void historyActions.seek().then((ok) => {
            if (ok) setSeekFirst(true)
          })
      }
    }
    element.addEventListener('keydown', jump)
    return () => element.removeEventListener('keydown', jump)
  }, [pin, virtualizer, history, historyActions])
  useLayoutEffect(() => {
    const element = scroller.current
    sendTarget.current = Math.max(0, scrollSize - (element?.clientHeight ?? 0))
    if (!pinned.current || rows.length === 0 || !element) {
      releaseScrollSpace()
      return
    }
    // Growth glides; opening the thread, resizing it or seeking far lands at once.
    const key = `${view}:${width}`
    const last = virtualizer.measurementsCache[rows.length - 1]
    const anchor = lastRow.current
    lastRow.current = last && { key: last.key, start: last.start }
    if (sendGlide.current) {
      if (landed.current.key === key && !reducedMotion.matches) return
      stopSendGlide()
    }
    if (sendPending.current && sentStart !== undefined && element.clientHeight > 0) {
      sendPending.current = false
      if (!reducedMotion.matches) {
        const message = virtualizer.measurementsCache[sentIndex]!
        // Bring a distant sent message into view at the bottom before gliding it to the top.
        const start = Math.min(
          sendTarget.current,
          Math.max(element.scrollTop, sentStart + message.size + sentInset - element.clientHeight)
        )
        element.scrollTop = start
        shownTop.current = element.scrollTop
        landed.current = { key, at: performance.now() }
        virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false
        sendGlide.current = animate(0, 1, {
          ...getSendMotionTransition(),
          onUpdate: (progress) => {
            element.scrollTop = start + (sendTarget.current - start) * progress
            shownTop.current = element.scrollTop
          },
          onComplete: () => {
            sendGlide.current = undefined
            virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
            releaseScrollSpace()
          },
        })
        return
      }
    }
    const glides =
      !reducedMotion.matches &&
      (following.current || sendTarget.current - element.scrollTop < element.clientHeight) &&
      landed.current.key === key &&
      performance.now() - landed.current.at > 300
    if (glides) {
      const glide = gliderFor(element)
      // Preserve the visible reply when rows above the viewport resize.
      if (
        last &&
        anchor?.key === last.key &&
        anchor.start < shownTop.current &&
        anchor.start !== last.start
      )
        glide.write(shownTop.current + last.start - anchor.start)
      glide.start()
      return
    }
    if (landed.current.key !== key) landed.current = { key, at: performance.now() }
    glider.current?.stop()
    releaseScrollSpace()
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [
    virtualizer,
    rows.length,
    stamp,
    width,
    scrollSize,
    viewportHeight,
    view,
    gliderFor,
    sentStart,
    sentIndex,
    stopSendGlide,
    releaseScrollSpace,
  ])
  useEffect(
    () => () => {
      glider.current?.stop()
      stopSendGlide()
    },
    [stopSendGlide]
  )

  // Something new at the end while the reader is up the thread puts a dot on the arrow; growth
  // below them can also carry them past the point where it shows.
  const tailRow = rows.at(-1)
  const tail = tailRow ? `${tailRow.id}:${rowStamp(tailRow)}` : ''
  const seenTail = useRef(tail)
  useEffect(() => {
    const element = scroller.current
    if (element) checkMessages(element)
    if (tail === seenTail.current) return
    seenTail.current = tail
    if (!pinned.current) setFresh(true)
  }, [tail, totalSize, checkMessages])

  // Far up, it lands a screen short first, then glides the rest the way the list follows its
  // bottom; under reduced motion it lands at once.
  const toBottom = useCallback(() => {
    const element = scroller.current
    if (!element) return
    pin(true)
    stopSendGlide()
    if (reducedMotion.matches) {
      virtualizer.scrollToIndex(latestRows.current.length - 1, { align: 'end' })
      return
    }
    const start = element.scrollHeight - element.clientHeight * 2
    if (element.scrollTop < start) element.scrollTop = start
    gliderFor(element).start()
  }, [pin, virtualizer, gliderFor, stopSendGlide])

  const [seekFirst, setSeekFirst] = useState(false)
  useLayoutEffect(() => {
    if (!seekFirst) return
    setSeekFirst(false)
    pin(false)
    virtualizer.scrollToOffset(0)
  }, [seekFirst, virtualizer, pin])

  const [revealId, clearReveal] = useRevealRow(threadId)
  useEffect(() => {
    if (!revealId || agentId) return
    const target = items.find((item) => item.id === revealId)
    const index = rows.findIndex((row) => rowContains(row, revealId, target))
    if (index === -1) {
      if (!target) void historyActions.seek(revealId)
      else if (bot && revealedTurn !== target.turnId) setRevealedTurn(target.turnId)
      return
    }
    clearReveal()
    pin(false)
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [
    revealId,
    agentId,
    rows,
    items,
    virtualizer,
    clearReveal,
    pin,
    historyActions,
    bot,
    revealedTurn,
  ])

  const localTurns = useTurns(rows)
  const turns = summary?.turns ?? localTurns
  const latestWidth = useRef(width)
  useLayoutEffect(() => {
    latestRows.current = rows
    latestMessageIndices.current = messageIndices
    latestWidth.current = width
  })
  useLayoutCheck(scroller, virtualizer, latestRows, pinned)

  useLayoutEffect(() => {
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
      if (reserved.current && element.clientHeight > height) {
        // Grow the sent message's space before a disappearing composer row clamps the chat.
        const space = element.firstElementChild as HTMLElement
        const top = pinned.current ? Math.max(0, scrollExtent.current - height) : shownTop.current
        space.style.height = `${Math.max(space.offsetHeight, scrollExtent.current + element.clientHeight - height)}px`
        element.scrollTop = top
        shownTop.current = element.scrollTop
        flushSync(() => setViewportHeight(element.clientHeight))
      } else setViewportHeight(element.clientHeight)
      // A pinned list keeps its bottom in view as the window or the composer takes height from it.
      if (pinned.current && !reserved.current && element.clientHeight < height)
        element.scrollTop += height - element.clientHeight
      height = element.clientHeight
      checkMessages(element)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [virtualizer, checkMessages])

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
    (itemId: string) => {
      const index = latestRows.current.findIndex((row) => row.id === itemId)
      if (index === -1) {
        void historyActions.seek(itemId).then((ok) => {
          if (ok) setSeekItem(itemId)
        })
        return
      }
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
    [virtualizer, pin, historyActions]
  )
  const [seekItem, setSeekItem] = useState<string>()
  useLayoutEffect(() => {
    if (!seekItem) return
    setSeekItem(undefined)
    jumpTo(seekItem)
  }, [seekItem, jumpTo])

  const virtualRows = virtualizer.getVirtualItems()
  const firstVisible = virtualRows[0]?.key
  const lastVisible = virtualRows.at(-1)?.key
  const openedHistory = useRef(false)
  useEffect(() => {
    if (!history || agentId) return
    const element = scroller.current
    const firstOpen = !openedHistory.current
    openedHistory.current = true
    if (
      history.ranges[0]?.start &&
      (firstOpen || (element && element.scrollTop < element.clientHeight * 12))
    )
      void historyActions.older()
  }, [history, agentId, firstVisible, historyActions])
  useEffect(() => {
    const ids = virtualizer.getVirtualItems().flatMap((entry) => {
      const row = latestRows.current[entry.index]!
      return row.kind === 'work'
        ? row.activities
            .filter((activity) => activity.type === 'tool' && activity.outputBytes !== undefined)
            .map((activity) => activity.id)
        : []
    })
    historyActions.warm(ids)
  }, [firstVisible, lastVisible, history, historyActions, virtualizer])

  return (
    <MediaLightboxProvider>
      <div
        data-perf-region='messages'
        className='relative flex min-h-0 flex-1 flex-col [timeline-scope:--chat-top]'
      >
        <section
          ref={scroller}
          className='scrollbar-subtle [scrollbar-gutter:stable_both-edges] [scroll-timeline:--chat-top_block] min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
          aria-label='Conversation'
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the page does not scroll, so this scrollport has to be focusable
          tabIndex={0}
          onScroll={({ currentTarget: element }) => {
            // Only the reader's own scroll up lets go. The browser moves the list up too, clamping
            // it to content that shrank for a layout, and the glide can trail the bottom.
            const up = element.scrollTop < shownTop.current - 1
            const hand = byHand.current.held || performance.now() - byHand.current.at < 500
            const behind = scrollExtent.current - element.clientHeight - element.scrollTop
            shownTop.current = element.scrollTop
            // A clamp that keeps the list on its bottom (a taller window) isn't letting go.
            if (up && hand && behind >= 1) pin(false)
            // Coming back down near the bottom holds on, as does landing right on it; the
            // virtualizer holding a reader's place as a row above grows doesn't.
            // A cancelled send glide can still have a scroll event queued.
            else if (!sendInterrupted.current && behind < (hand && !up ? pinSlack : 1)) pin(true)
            checkMessages(element)
          }}
        >
          <div className='relative w-full' style={{ height: Math.max(scrollSize, scrollSpace) }}>
            {virtualRows.map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                data-history-row={rows[virtualRow.index]!.id}
                onPointerEnter={() => {
                  const row = rows[virtualRow.index]!
                  if (row.kind === 'work')
                    historyActions.warm(
                      row.activities
                        .filter(
                          (activity) =>
                            activity.type === 'tool' && activity.outputBytes !== undefined
                        )
                        .map((activity) => activity.id)
                    )
                }}
                ref={virtualizer.measureElement}
                className='absolute top-0 left-0 w-full'
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  className={cn(
                    'mx-auto w-full max-w-[873px] px-6',
                    paddedRows.has(rows[virtualRow.index]!.kind) && 'py-1.5'
                  )}
                >
                  <ThreadItemRow
                    row={rows[virtualRow.index]!}
                    threadId={threadId}
                    provider={provider}
                    projectPath={projectPath}
                    onOpenRoom={onOpenRoom}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <div
          aria-hidden='true'
          className='chat-top-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-linear-to-b from-background to-transparent'
        />
        <ScrollToBottom
          shown={remainingMessages > 0}
          fresh={fresh}
          messages={remainingMessages}
          onScroll={toBottom}
        />
        {!agentId && (
          <AddToPrompt chatRef={scroller} onAdd={(reply) => chatComposer(threadId)?.quote(reply)} />
        )}
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

import { cn } from '@/lib/utils'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type WheelEvent } from 'react'

import { ActivityDisclosure, type ActivityView } from './activity_disclosure'
import { Markdown } from './markdown'
import { RollingDuration } from './rolling_duration'
import { ThinkingBlock } from './thinking_block'
import { TodoLink } from './todo_link'
import { ThreadGroup, ToolGroup } from './tool_group'
import {
  formatActivityDuration,
  groupWorkActivities,
  previewCount,
  type ActivityStatus,
  type WorkActivity,
  type WorkEntry,
  workEnded,
} from './work_model'

// Entries scrolled out of a live preview fade at that edge.
function edges(element: HTMLElement) {
  element.toggleAttribute('data-above', element.scrollTop > 0)
  element.toggleAttribute(
    'data-below',
    element.scrollHeight - element.scrollTop - element.clientHeight > 1
  )
}

function WorkHistory({
  threadId,
  entries,
  view,
  live,
}: {
  threadId: string
  entries: WorkEntry[]
  view: ActivityView
  live: boolean
}) {
  const reducedMotion = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const shown = useRef(view)

  // A live preview is as tall as its latest entries and scrolls back through the rest, pinned to
  // the newest. Writes go straight to the node, so a growing entry never re-renders the log.
  useLayoutEffect(() => {
    const element = scroller.current!
    const list = element.firstElementChild as HTMLElement
    const closing = shown.current === 'full' && view === 'preview'
    shown.current = view
    if (!live || view === 'full') {
      if (!element.style.maxHeight) return
      // Opening grows to the whole log and a finished block keeps its preview while it closes;
      // either way it then sizes itself.
      if (live) element.style.maxHeight = `${list.offsetHeight}px`
      const release = setTimeout(
        () => {
          element.style.maxHeight = ''
          edges(element)
        },
        reducedMotion ? 0 : 250
      )
      return () => clearTimeout(release)
    }
    if (closing) {
      // Shrinks from the open height, which a cap of none can't transition from.
      element.style.maxHeight = `${element.offsetHeight}px`
      void element.offsetHeight
    }
    pinned.current = true
    function measure() {
      let height = 0
      for (const row of [...list.children].slice(-previewCount)) height += row.scrollHeight
      element.style.maxHeight = `${height}px`
      if (pinned.current) element.scrollTop = element.scrollHeight
      edges(element)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(list)
    return () => observer.disconnect()
  }, [live, view, reducedMotion])

  // Only the reader unpins: the pin's own scrolls land a frame late, mid-animation.
  function onScroll() {
    const element = scroller.current!
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 2) pinned.current = true
    edges(element)
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY < 0 && event.currentTarget.scrollTop > 0) pinned.current = false
  }

  return (
    <div
      ref={scroller}
      className='work-scroll no-scrollbar overflow-y-auto'
      onScroll={onScroll}
      onWheel={onWheel}
    >
      <div>
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              className='overflow-hidden'
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              transition={{ duration: reducedMotion ? 0 : 0.25, ease: [0.25, 1, 0.5, 1] }}
            >
              {entry.type === 'thinking' ? (
                <ThinkingBlock activity={entry} />
              ) : entry.type === 'text' ? (
                <Markdown className='work-text' reply={entry.id}>
                  {entry.text}
                </Markdown>
              ) : entry.type === 'todo' ? (
                <TodoLink threadId={threadId} update={entry.update} />
              ) : entry.type === 'threads' ? (
                <ThreadGroup batch={entry} />
              ) : (
                <ToolGroup batch={entry} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function useRunningSeconds(startedAt?: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startedAt === undefined) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const current = Date.now()
      setNow(current)
      timer = setTimeout(tick, 1000 - ((current - startedAt) % 1000))
    }
    tick()
    return () => clearTimeout(timer)
  }, [startedAt])
  return startedAt === undefined ? undefined : Math.max(0, (now - startedAt) / 1000)
}

export function WorkBlock({
  threadId,
  activities,
  status,
  startedAt,
  elapsedSeconds,
  settingUp,
  restarted,
}: {
  threadId: string
  activities: readonly WorkActivity[]
  status: ActivityStatus
  startedAt?: number
  elapsedSeconds?: number
  settingUp?: boolean
  restarted?: boolean
}) {
  const runningSeconds = useRunningSeconds(
    status === 'running' && !settingUp ? startedAt : undefined
  )
  const ended = workEnded(status)
  const entries = groupWorkActivities(activities, ended)
  const duration = formatActivityDuration(elapsedSeconds)
  const heading = settingUp
    ? 'Setting up worktree'
    : status === 'waiting'
      ? 'Waiting for you'
      : status === 'running'
        ? 'Working'
        : status === 'complete' || status === 'failed'
          ? restarted
            ? 'Work interrupted'
            : 'Worked'
          : status === 'cancelled'
            ? 'Work cancelled'
            : duration
              ? 'You stopped'
              : 'You stopped this response'
  const timing =
    runningSeconds !== undefined ? (
      <span className='inline-flex items-baseline whitespace-pre'>
        {' for '}
        <RollingDuration seconds={runningSeconds} />
      </span>
    ) : duration ? (
      <>
        {` ${restarted || status === 'cancelled' || status === 'interrupted' ? 'after' : 'for'} `}
        <span className='font-mono'>{duration}</span>
      </>
    ) : (
      ''
    )
  return (
    <ActivityDisclosure
      flushHeader
      title={<span className={cn(status === 'running' && 'shimmer')}>{heading}</span>}
      titleSuffix={timing}
      ended={ended}
      hasContent={entries.length > 0}
      hasPreview={entries.length > previewCount}
      renderContent={(view) => (
        <WorkHistory threadId={threadId} entries={entries} view={view} live={!ended} />
      )}
    />
  )
}

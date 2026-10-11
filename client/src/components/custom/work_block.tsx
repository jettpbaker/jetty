import { bottomGlide } from '@/lib/bottom-glide'
import { cn } from '@/lib/utils'
import { completedAgo } from '@/state/threads'
import { useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type WheelEvent } from 'react'

import { ActivityDisclosure, type ActivityView } from './activity_disclosure'
import { Markdown } from './markdown'
import { RollingDuration } from './rolling_duration'
import { ThinkingBlock } from './thinking_block'
import { TodoLink } from './todo_link'
import { ThreadGroup, ToolGroup } from './tool_group'
import {
  formatActivityDuration,
  createWorkEntries,
  previewCount,
  type ActivityStatus,
  type WorkActivity,
  type WorkEntry,
  workEnded,
} from './work_model'

// Animated digits and row entrances can extend scrollHeight beyond the laid-out rows.
function historyBottom(element: HTMLElement) {
  const list = element.firstElementChild as HTMLElement
  return Math.max(0, list.offsetHeight - element.clientHeight)
}

// Entries scrolled out of a live preview fade at that edge.
function edges(element: HTMLElement, following = false) {
  element.toggleAttribute('data-above', element.scrollTop > 0)
  element.toggleAttribute(
    'data-below',
    !following && historyBottom(element) - element.scrollTop > 1
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
  const [initialEntries] = useState(() => new Set(entries.map((entry) => entry.id)))
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const glideRef = useRef<ReturnType<typeof bottomGlide> | null>(null)

  // A live preview is as tall as its latest entries and scrolls back through the rest, pinned to
  // the newest. Writes go straight to the node, so a growing entry never re-renders the log.
  useLayoutEffect(() => {
    const element = scroller.current!
    const list = element.firstElementChild as HTMLElement
    if (!live && element.style.maxHeight) {
      // Keep the preview capped until the parent finishes closing.
      const release = setTimeout(
        () => {
          element.style.maxHeight = ''
          edges(element)
        },
        reducedMotion ? 0 : 250
      )
      return () => clearTimeout(release)
    }
    if (!live || view === 'full') {
      element.style.maxHeight = ''
      edges(element)
      return
    }
    pinned.current = true
    const glide = bottomGlide(element, {
      onWrite: () => edges(element, pinned.current),
      target: () => historyBottom(element),
    })
    glideRef.current = glide
    let initial = true
    function measure() {
      let height = 0
      for (const row of [...list.children].slice(-previewCount))
        height += (row as HTMLElement).offsetHeight
      element.style.maxHeight = list.children.length > previewCount ? `${height}px` : ''
      if (pinned.current && list.children.length > previewCount) {
        if (initial || reducedMotion) glide.write(historyBottom(element))
        else glide.start()
      }
      initial = false
      edges(element, pinned.current)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(list)
    return () => {
      observer.disconnect()
      glide.stop()
      glideRef.current = null
    }
  }, [live, view, reducedMotion])

  // Only the reader unpins: the pin's own scrolls land a frame late, mid-animation.
  function onScroll() {
    const element = scroller.current!
    if (historyBottom(element) - element.scrollTop < 2) pinned.current = true
    edges(element, live && view === 'preview' && pinned.current)
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY < 0 && event.currentTarget.scrollTop > 0) {
      pinned.current = false
      glideRef.current?.stop()
    }
  }

  return (
    <div
      ref={scroller}
      className={cn('work-scroll no-scrollbar', entries.length > previewCount && 'overflow-y-auto')}
      onScroll={onScroll}
      onWheel={onWheel}
    >
      <div>
        {entries.map((entry, index) => (
          <div
            key={entry.id}
            className={cn(
              entry.type !== 'text' &&
                !initialEntries.has(entry.id) &&
                (entry.type === 'tools' ? 'work-batch-enter' : 'work-raise-enter')
            )}
          >
            {entry.type === 'thinking' ? (
              <ThinkingBlock activity={entry} />
            ) : entry.type === 'text' ? (
              <Markdown
                className={cn('work-text', index < entries.length - 1 && 'work-text-past')}
                streaming={entry.streaming}
                arrived={!entry.streaming && completedAgo(entry.id) < 1000}
                reply={entry.id}
              >
                {entry.text}
              </Markdown>
            ) : entry.type === 'todo' ? (
              <TodoLink threadId={threadId} update={entry.update} />
            ) : entry.type === 'threads' ? (
              <ThreadGroup batch={entry} />
            ) : (
              <ToolGroup batch={entry} />
            )}
          </div>
        ))}
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
  const [groupEntries] = useState(createWorkEntries)
  const entries = useMemo(() => groupEntries(activities, ended), [groupEntries, activities, ended])
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
      animateHeader={!ended}
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

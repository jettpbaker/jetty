import { bottomGlide } from '@/lib/bottom-glide'
import { getMotionTokens, motionMilliseconds } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { completedAgo } from '@/state/threads'
import { useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { ActivityDisclosure, type ActivityView } from './activity_disclosure'
import { Markdown } from './markdown'
import { QuestionBlock } from './question_block'
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
function edges(element: HTMLElement, following = false, top = element.scrollTop) {
  element.toggleAttribute('data-above', top > 0)
  element.toggleAttribute('data-below', !following && historyBottom(element) - top > 1)
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
  const releaseAnchorRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<(() => void) | null>(null)
  const heightAnimationRef = useRef<Animation | null>(null)
  const previousView = useRef(view)

  useEffect(() => () => heightAnimationRef.current?.cancel(), [])

  // A live preview is as tall as its latest entries and scrolls back through the rest, pinned to
  // the newest. Writes go straight to the node, so a growing entry never re-renders the log.
  useLayoutEffect(() => {
    const element = scroller.current!
    const list = element.firstElementChild as HTMLElement
    const changedView = previousView.current !== view
    previousView.current = view
    const previousHeight = element.getBoundingClientRect().height
    heightAnimationRef.current?.cancel()
    heightAnimationRef.current = null
    if (!live && element.style.maxHeight) {
      // Keep the preview capped until the parent finishes closing.
      const release = setTimeout(
        () => {
          element.style.maxHeight = ''
          list.style.marginTop = ''
          list.style.transform = ''
          edges(element)
        },
        reducedMotion ? 0 : getMotionTokens().disclosure.closeMs
      )
      return () => clearTimeout(release)
    }
    if (!live) {
      list.style.marginTop = ''
      list.style.transform = ''
      element.style.maxHeight = ''
      edges(element)
      return
    }
    list.style.marginTop = ''
    list.style.transform = ''
    pinned.current = true
    let bottom = 0
    let offset = 0
    let gliding = false
    let switching = changedView && !reducedMotion
    let anchored = view === 'preview' && !switching
    function position(top: number) {
      offset = top
      if (anchored) {
        // Remove older rows from the flow so shrinking details cannot clamp a bottom scroll pin.
        list.style.marginTop = `${-(pinned.current ? bottom : top)}px`
        list.style.transform =
          pinned.current && top !== bottom ? `translateY(${bottom - top}px)` : ''
        element.scrollTop = 0
      } else {
        list.style.marginTop = ''
        list.style.transform = ''
        element.scrollTop = top
      }
    }
    const glide = bottomGlide(element, {
      read: () => offset,
      apply: position,
      onWrite: () => edges(element, pinned.current, offset),
      onRun: (running) => (gliding = running),
      target: () => bottom,
    })
    releaseAnchorRef.current = () => {
      pinned.current = false
      glide.stop()
      anchored = false
      position(offset)
    }
    scrollRef.current = () => {
      if (!anchored) {
        offset = element.scrollTop
        if (bottom - offset < 2) pinned.current = true
      }
      edges(element, pinned.current, offset)
    }
    function anchorReader() {
      if (view !== 'preview' || switching || anchored) return
      offset = element.scrollTop
      anchored = true
      position(offset)
      edges(element, pinned.current, offset)
    }
    function onWheel(event: WheelEvent) {
      if (view !== 'preview' || !anchored || !event.deltaY) return
      const output = event.target instanceof Element ? event.target.closest('.tool-output') : null
      if (
        output &&
        (event.deltaY < 0
          ? output.scrollTop > 0
          : output.scrollTop < output.scrollHeight - output.clientHeight - 1)
      )
        return
      event.preventDefault()
      releaseAnchorRef.current?.()
      const step = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? element.clientHeight : 1
      element.scrollTop = Math.max(0, Math.min(bottom, offset + event.deltaY * step))
      offset = element.scrollTop
    }
    let initial = true
    let previewStart: Element | undefined
    function measure() {
      const nextPreviewStart = list.children[Math.max(0, list.children.length - previewCount)]
      const moved = nextPreviewStart !== previewStart
      previewStart = nextPreviewStart
      let height = list.offsetHeight
      if (view === 'preview') {
        height = 0
        for (const row of [...list.children].slice(-previewCount))
          height += (row as HTMLElement).offsetHeight
      }
      element.style.maxHeight = `${height}px`
      bottom = Math.max(0, list.offsetHeight - height)
      if (heightAnimationRef.current) {
        glide.write(historyBottom(element))
      } else if (view === 'preview' && pinned.current && list.children.length > previewCount) {
        if (initial || reducedMotion || (!moved && !gliding)) glide.write(bottom)
        else glide.start()
      }
      initial = false
      edges(element, pinned.current, offset)
    }
    measure()
    if (changedView && !reducedMotion && previousHeight !== element.clientHeight) {
      const styles = getComputedStyle(element)
      const duration = styles.getPropertyValue(
        view === 'full' ? '--motion-disclosure-open-duration' : '--motion-disclosure-close-duration'
      )
      const animation = element.animate(
        { maxHeight: [`${previousHeight}px`, element.style.maxHeight] },
        {
          duration: motionMilliseconds(duration),
          easing: styles.getPropertyValue('--motion-disclosure-ease').trim(),
        }
      )
      heightAnimationRef.current = animation
      glide.write(historyBottom(element))
      animation.onfinish = () => {
        heightAnimationRef.current = null
        switching = false
        anchored = view === 'preview'
        measure()
      }
    } else if (switching) {
      switching = false
      anchored = view === 'preview'
      measure()
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(list)
    function onKeyDown(event: KeyboardEvent) {
      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return
      if (view !== 'preview') {
        releaseAnchorRef.current?.()
        return
      }
      if (event.target instanceof Element && event.target.closest('.tool-output')) return
      event.preventDefault()
      const destinations: Record<string, number> = {
        ArrowUp: offset - 20,
        ArrowDown: offset + 20,
        PageUp: offset - element.clientHeight,
        PageDown: offset + element.clientHeight,
        Home: 0,
        End: bottom,
      }
      const top = Math.max(0, Math.min(bottom, destinations[event.key]!))
      glide.stop()
      pinned.current = top === bottom
      anchored = true
      position(top)
      edges(element, pinned.current, offset)
    }
    element.addEventListener('keydown', onKeyDown)
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('scrollend', anchorReader)
    element.addEventListener('click', anchorReader, true)
    return () => {
      observer.disconnect()
      element.removeEventListener('keydown', onKeyDown)
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('scrollend', anchorReader)
      element.removeEventListener('click', anchorReader, true)
      glide.stop()
      releaseAnchorRef.current = null
      scrollRef.current = null
    }
  }, [live, view, reducedMotion])

  function onScroll() {
    scrollRef.current?.()
  }

  function unpin() {
    releaseAnchorRef.current?.()
  }

  return (
    <div
      ref={scroller}
      className={cn('work-scroll no-scrollbar', entries.length > previewCount && 'overflow-y-auto')}
      onScroll={onScroll}
      onTouchStart={unpin}
    >
      <div>
        {entries.map((entry, index) => (
          <div
            key={entry.id}
            data-quote={entry.type === 'text' ? entry.id : undefined}
            className={cn(
              entry.type !== 'text' &&
                !initialEntries.has(entry.id) &&
                (entry.type === 'tools' &&
                !['read', 'edit', 'write', 'terminal'].includes(entry.calls[0]!.kind)
                  ? 'work-batch-enter'
                  : 'work-raise-enter')
            )}
          >
            {entry.type === 'thinking' ? (
              <ThinkingBlock activity={entry} />
            ) : entry.type === 'question' ? (
              <QuestionBlock activity={entry} />
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
      renderContent={(view) => (
        <WorkHistory threadId={threadId} entries={entries} view={view} live={!ended} />
      )}
    />
  )
}

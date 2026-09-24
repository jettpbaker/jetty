import { cn } from '@/lib/utils'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import { ActivityDisclosure, type ActivityView } from './activity_disclosure'
import { Markdown } from './markdown'
import { RollingDuration } from './rolling_duration'
import { ThinkingBlock } from './thinking_block'
import { ToolGroup } from './tool_group'
import {
  formatActivityDuration,
  groupWorkActivities,
  previewCount,
  type ActivityStatus,
  type WorkActivity,
  type WorkEntry,
  workEnded,
} from './work_model'

function WorkHistory({
  entries,
  recentStart,
  view,
}: {
  entries: WorkEntry[]
  recentStart: number
  view: ActivityView
}) {
  const reducedMotion = useReducedMotion()
  return (
    <div className={view === 'preview' && recentStart > 0 ? 'work-recent' : undefined}>
      <AnimatePresence initial={false}>
        {entries.map((entry, index) => {
          const visible = view === 'full' || index >= recentStart
          return (
            <motion.div
              key={entry.id}
              inert={!visible}
              aria-hidden={!visible}
              className='overflow-hidden'
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: visible ? 'auto' : 0, opacity: visible ? 1 : 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.25, ease: [0.25, 1, 0.5, 1] }}
            >
              {entry.type === 'thinking' ? (
                <ThinkingBlock activity={entry} />
              ) : entry.type === 'text' ? (
                <Markdown className='work-text'>{entry.text}</Markdown>
              ) : (
                <ToolGroup batch={entry} />
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
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
  activities,
  status,
  startedAt,
  elapsedSeconds,
  restarted,
}: {
  activities: readonly WorkActivity[]
  status: ActivityStatus
  startedAt?: number
  elapsedSeconds?: number
  restarted?: boolean
}) {
  const runningSeconds = useRunningSeconds(status === 'running' ? startedAt : undefined)
  const ended = workEnded(status)
  const entries = groupWorkActivities(activities, ended)
  const duration = formatActivityDuration(elapsedSeconds)
  const heading = restarted
    ? 'Interrupted — jetty restarted'
    : status === 'waiting'
      ? 'Waiting for you'
      : status === 'running'
        ? 'Working'
        : status === 'complete' || status === 'failed'
          ? 'Worked'
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
      ` ${status === 'cancelled' || status === 'interrupted' ? 'after' : 'for'} ${duration}`
    ) : (
      ''
    )
  const recentStart = Math.max(0, entries.length - previewCount)
  return (
    <ActivityDisclosure
      flushHeader
      title={<span className={cn(status === 'running' && 'shimmer')}>{heading}</span>}
      titleSuffix={timing}
      ended={ended}
      hasContent={entries.length > 0}
      hasPreview={recentStart > 0}
      renderContent={(view) => (
        <WorkHistory entries={entries} recentStart={recentStart} view={view} />
      )}
    />
  )
}

import { cn } from '@/lib/utils'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { ActivityDisclosure, type ActivityView } from './activity_disclosure'
import { ThinkingBlock } from './thinking_block'
import { ToolGroup } from './tool_group'
import {
  formatActivityDuration,
  groupWorkActivities,
  type ActivityStatus,
  type WorkActivity,
  type WorkEntry,
} from './work_model'

const previewCount = 3

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

export function WorkBlock({
  activities,
  status,
  elapsedSeconds,
}: {
  activities: readonly WorkActivity[]
  status: ActivityStatus
  elapsedSeconds?: number
}) {
  const ended = ['complete', 'failed', 'cancelled', 'interrupted'].includes(status)
  const entries = groupWorkActivities(activities, ended)
  const duration = formatActivityDuration(elapsedSeconds)
  const heading =
    status === 'waiting'
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
  const timing = duration
    ? ` ${status === 'cancelled' || status === 'interrupted' ? 'after' : 'for'} ${duration}`
    : ''
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

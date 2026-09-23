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

function WorkEntryView({ entry }: { entry: WorkEntry }) {
  return entry.type === 'thinking' ? (
    <ThinkingBlock activity={entry} />
  ) : (
    <ToolGroup batch={entry} />
  )
}

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
              <WorkEntryView entry={entry} />
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
  previewCount = 3,
  defaultView,
}: {
  activities: readonly WorkActivity[]
  status: ActivityStatus
  elapsedSeconds?: number
  previewCount?: number
  defaultView?: ActivityView
}) {
  const ended = ['complete', 'failed', 'cancelled', 'interrupted'].includes(status)
  const entries = groupWorkActivities(activities, ended)
  const waiting = activities.filter(
    (activity) => activity.type === 'tool' && activity.status === 'waiting'
  )
  const duration = formatActivityDuration(elapsedSeconds)
  const heading =
    waiting.length || status === 'waiting'
      ? 'Waiting for approval'
      : status === 'running'
        ? 'Working'
        : status === 'complete'
          ? 'Worked'
          : status === 'failed'
            ? 'Work failed'
            : status === 'cancelled'
              ? 'Work cancelled'
              : 'Work interrupted'
  const timing = duration ? ` ${ended && status !== 'complete' ? 'after' : 'for'} ${duration}` : ''
  const recentStart = Math.max(0, entries.length - Math.max(1, previewCount))
  return (
    <ActivityDisclosure
      flushHeader
      title={heading}
      titleSuffix={timing}
      ended={ended}
      hasContent={entries.length > 0}
      defaultView={defaultView}
      hasPreview={recentStart > 0}
      renderContent={(view) => (
        <WorkHistory entries={entries} recentStart={recentStart} view={view} />
      )}
    />
  )
}

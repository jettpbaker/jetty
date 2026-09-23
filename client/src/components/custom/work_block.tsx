import { Button } from '@/components/ui/button'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { ActivityDisclosure, type ActivityView } from './activity_disclosure'
import { ThinkingBlock } from './thinking_block'
import { ToolGroup } from './tool_group'
import {
  formatActivityDuration,
  groupWorkActivities,
  type ActivityStatus,
  type ToolActivity,
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
  onApproval,
}: {
  activities: readonly WorkActivity[]
  status: ActivityStatus
  elapsedSeconds?: number
  onApproval: (id: string, approved: boolean) => void
}) {
  const ended = ['complete', 'failed', 'cancelled', 'interrupted'].includes(status)
  const entries = groupWorkActivities(activities, ended)
  const waiting = activities.filter(
    (activity): activity is ToolActivity =>
      activity.type === 'tool' && activity.status === 'waiting'
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
  const recentStart = Math.max(0, entries.length - previewCount)
  return (
    <ActivityDisclosure
      flushHeader
      title={heading}
      titleSuffix={timing}
      ended={ended}
      hasContent={entries.length > 0}
      hasPreview={recentStart > 0}
      renderContent={(view) => (
        <WorkHistory entries={entries} recentStart={recentStart} view={view} />
      )}
      footer={
        waiting.length > 0 && (
          <div className='mx-2 mt-2 flex flex-col gap-2 rounded-sm border border-border bg-card p-3'>
            {waiting.map((call) => (
              <div key={call.id} className='flex flex-col gap-2'>
                <p className='text-xs text-muted-foreground'>
                  Allow <span className='font-mono break-all text-foreground'>{call.target}</span>?
                </p>
                <div className='flex gap-2'>
                  <Button size='xs' onClick={() => onApproval(call.id, true)}>
                    Allow once
                  </Button>
                  <Button size='xs' variant='ghost-text' onClick={() => onApproval(call.id, false)}>
                    Deny
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )
      }
    />
  )
}

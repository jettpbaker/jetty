import { Button } from '@/components/ui/button'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useId, useState } from 'react'

import './work.css'
import { ActivityContent } from './activity_content'
import { ThinkingBlock } from './thinking_block'
import { ToolGroup } from './tool_group'
import {
  groupWorkActivities,
  type ToolActivity,
  type WorkActivity,
  type WorkEntry,
} from './work_model'

const previewCount = 3

function WorkHistory({
  entries,
  recentStart,
  full,
}: {
  entries: WorkEntry[]
  recentStart: number
  full: boolean
}) {
  const reducedMotion = useReducedMotion()
  return (
    <div className={!full && recentStart > 0 ? 'work-recent' : undefined}>
      <AnimatePresence initial={false}>
        {entries.map((entry, index) => {
          const visible = full || index >= recentStart
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
  onApproval,
}: {
  activities: readonly WorkActivity[]
  onApproval: (id: string, approved: boolean) => void
}) {
  const id = useId()
  const waiting = activities.filter(
    (activity): activity is ToolActivity =>
      activity.type === 'tool' && activity.status === 'waiting'
  )
  const running = activities.some((activity) => activity.status === 'running')
  const ended = waiting.length === 0 && !running
  const entries = groupWorkActivities(activities, ended)
  const recentStart = Math.max(0, entries.length - previewCount)
  const [showAll, setShowAll] = useState(false)
  const [closed, setClosed] = useState(ended)
  const [previousEnded, setPreviousEnded] = useState(ended)
  if (previousEnded !== ended) {
    setPreviousEnded(ended)
    setClosed(ended)
  }
  const heading = (
    <span>
      {waiting.length > 0
        ? 'Waiting for approval'
        : running
          ? 'Working'
          : activities.some((activity) => activity.status === 'failed')
            ? 'Work failed'
            : 'Worked'}
    </span>
  )
  return (
    <div className='min-w-0'>
      {(ended ? entries.length > 0 : recentStart > 0) ? (
        <Button
          variant='ghost-text'
          className='activity-header'
          data-flush
          aria-expanded={ended ? !closed : showAll}
          aria-controls={id}
          onClick={() => (ended ? setClosed(!closed) : setShowAll(!showAll))}
        >
          {heading}
        </Button>
      ) : (
        <div className='activity-header text-muted-foreground' data-flush>
          {heading}
        </div>
      )}
      <ActivityContent id={id} open={!ended || !closed}>
        <WorkHistory entries={entries} recentStart={recentStart} full={ended || showAll} />
      </ActivityContent>
      {waiting.length > 0 && (
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
      )}
    </div>
  )
}

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useState } from 'react'

import { ActivityChevron } from './activity_disclosure'
import { ThreadLink } from './entity_link'
import { RollingNumber } from './rolling_number'
import { RollingText } from './rolling_text'
import { ToolCall, ToolCallDetails } from './tool_call'
import {
  describeToolBatch,
  workEnded,
  type CreatedActivity,
  type ThreadBatch,
  type ToolBatch,
} from './work_model'

export function ToolGroup({ batch }: { batch: ToolBatch }) {
  const label = describeToolBatch(batch)
  const autoOpen =
    label.itemCount !== undefined &&
    (!batch.sealed || batch.calls.some((call) => !workEnded(call.status)))
  const [previousAutoOpen, setPreviousAutoOpen] = useState(autoOpen)
  const [open, setOpen] = useState(autoOpen)
  const [autoClosing, setAutoClosing] = useState(false)
  const [initialCalls] = useState(() => new Set(batch.calls.map((call) => call.id)))
  if (previousAutoOpen !== autoOpen) {
    setPreviousAutoOpen(autoOpen)
    setAutoClosing(!autoOpen && open)
    setOpen(autoOpen)
  }
  function onOpenChange(nextOpen: boolean) {
    setAutoClosing(false)
    setOpen(nextOpen)
  }
  const heading = (
    <>
      <span className='flex min-w-0 items-baseline gap-1'>
        <span className={cn('shrink-0', label.active && 'shimmer')}>{label.verb}</span>
        {label.itemCount !== undefined ? (
          <span className='inline-flex items-baseline gap-1'>
            <RollingNumber value={label.itemCount} className='font-mono' />
            <span>{label.countNoun}</span>
          </span>
        ) : label.target ? (
          <RollingText key={label.verb} className={cn(!label.prose && 'font-mono')}>
            {label.target}
          </RollingText>
        ) : null}
      </span>
      {label.notices.length > 0 && (
        <span
          className={cn(
            'shrink-0 text-xs',
            label.failed ? 'text-status-error' : 'text-muted-foreground'
          )}
        >
          {label.notices.map((notice, index) => (
            <span key={notice.status}>
              {index > 0 && ', '}
              <RollingNumber value={notice.count} className='font-mono' /> {notice.text}
            </span>
          ))}
        </span>
      )}
    </>
  )
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='activity-header'
        aria-label={`${label.verb} ${label.target}${label.noticeText ? `, ${label.noticeText}` : ''}`}
      >
        {heading}
        <ActivityChevron />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(autoClosing && 'work-batch-auto-close')}>
        {batch.calls.length === 1 && label.itemCount === undefined ? (
          <ToolCallDetails call={batch.calls[0]!} />
        ) : (
          <div className='pl-2'>
            {batch.calls.map((call) => (
              <ToolCall
                key={call.id}
                call={call}
                animate={label.itemCount !== undefined && autoOpen && !initialCalls.has(call.id)}
              />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function CreatedThread({ thread }: { thread: CreatedActivity }) {
  return (
    <div className='activity-header items-center gap-1 text-muted-foreground'>
      Created
      <ThreadLink id={thread.threadId} fallback={thread.title ?? 'a thread'} />
    </div>
  )
}

export function ThreadGroup({ batch }: { batch: ThreadBatch }) {
  const { threads } = batch
  if (threads.length === 1) return <CreatedThread thread={threads[0]!} />
  const count = `${threads.length} threads`
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='activity-header'
        aria-label={`Created ${count}`}
      >
        <span className='flex min-w-0 items-baseline gap-1'>
          <span className='shrink-0'>Created</span>
          <RollingText>{count}</RollingText>
        </span>
        <ActivityChevron />
      </CollapsibleTrigger>
      <CollapsibleContent className='pl-2'>
        <div>
          {threads.map((thread) => (
            <CreatedThread key={thread.id} thread={thread} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

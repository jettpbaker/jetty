import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useState } from 'react'

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
    label.fileCount !== undefined &&
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
        {label.description ? (
          <span
            className={cn(
              'truncate',
              label.active && 'shimmer',
              label.failed && 'text-status-error'
            )}
          >
            {label.description}
          </span>
        ) : (
          <>
            <span className={cn('shrink-0', label.active && 'shimmer')}>{label.verb}</span>
            {label.fileCount !== undefined ? (
              <span className='inline-flex items-baseline gap-1'>
                <RollingNumber value={label.fileCount} className='font-mono' />
                <span>{label.fileCount === 1 ? 'file' : 'files'}</span>
              </span>
            ) : label.target ? (
              <RollingText key={label.verb} className={cn(!label.prose && 'font-mono')}>
                {label.target}
              </RollingText>
            ) : null}
          </>
        )}
      </span>
      {label.notices.length > 0 && (
        <span
          className={cn(
            'ml-auto shrink-0 text-xs',
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
  if (batch.calls[0]!.kind === 'web')
    return (
      <div
        className={cn('activity-header text-muted-foreground', label.failed && 'text-status-error')}
      >
        {heading}
      </div>
    )
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='activity-header'
        aria-label={`${label.description ?? `${label.verb} ${label.target}`}${label.noticeText ? `, ${label.noticeText}` : ''}`}
      >
        {heading}
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('pl-2', autoClosing && 'work-batch-auto-close')}>
        {batch.calls.length === 1 && label.fileCount === undefined ? (
          <ToolCallDetails call={batch.calls[0]!} />
        ) : (
          <div>
            {batch.calls.map((call) => (
              <ToolCall
                key={call.id}
                call={call}
                animate={label.fileCount !== undefined && autoOpen && !initialCalls.has(call.id)}
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

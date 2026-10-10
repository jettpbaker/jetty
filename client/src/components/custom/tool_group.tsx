import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useBatchTense, useChatFeel } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'

import { ThreadLink } from './entity_link'
import { RollingText } from './rolling_text'
import { ToolCall, ToolCallDetails } from './tool_call'
import {
  describeToolBatch,
  type CreatedActivity,
  type ThreadBatch,
  type ToolBatch,
} from './work_model'

export function ToolGroup({ batch }: { batch: ToolBatch }) {
  const feel = useChatFeel()
  const batchTense = useBatchTense()
  const openTense = feel === 'hybrid' && batchTense === 'open'
  const label = describeToolBatch(batch, openTense)
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='activity-header'
        data-batch-tense={openTense ? 'open' : undefined}
        data-batch-open={openTense && !batch.sealed ? '' : undefined}
        aria-label={`${label.description ?? `${label.verb} ${label.target}`}${label.notices ? `, ${label.notices}` : ''}`}
      >
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
              {openTense ? (
                <RollingText className={cn('shrink-0', label.active && 'shimmer')}>
                  {label.verb}
                </RollingText>
              ) : (
                <span className={cn('shrink-0', label.active && 'shimmer')}>{label.verb}</span>
              )}
              <RollingText
                key={openTense ? undefined : label.verb}
                className={cn(!label.prose && 'font-mono')}
              >
                {label.target}
              </RollingText>
            </>
          )}
        </span>
        {label.notices && (
          <span
            className={cn(
              'ml-auto shrink-0 text-xs',
              label.failed ? 'text-status-error' : 'text-muted-foreground'
            )}
          >
            {label.notices}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {batch.calls.length === 1 ? (
          <ToolCallDetails call={batch.calls[0]!} />
        ) : (
          <div className='pb-1'>
            {batch.calls.map((call) => (
              <ToolCall key={call.id} call={call} />
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
      <CollapsibleContent>
        <div className='pb-1'>
          {threads.map((thread) => (
            <CreatedThread key={thread.id} thread={thread} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

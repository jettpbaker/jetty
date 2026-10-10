import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  hybridLabelHoldMs,
  useBatchLabel,
  useBatchTense,
  useChatFeel,
  useTenseChange,
} from '@/lib/chat-feel'
import { cn } from '@/lib/utils'

import { ThreadLink } from './entity_link'
import { RollingText } from './rolling_text'
import { TenseText } from './tense_text'
import { ToolCall, ToolCallDetails } from './tool_call'
import {
  describeToolBatch,
  type CreatedActivity,
  type ThreadBatch,
  type ToolBatch,
} from './work_model'

export function ToolGroup({ batch }: { batch: ToolBatch }) {
  const feel = useChatFeel()
  const tenseChange = useTenseChange()
  const tenseText = feel === 'hybrid' && tenseChange !== undefined
  const batchTense = useBatchTense()
  const openTense = feel === 'hybrid' && batchTense === 'open'
  const batchLabel = useBatchLabel()
  const holdMs = feel === 'hybrid' && batchLabel !== 'each' ? hybridLabelHoldMs : 0
  const countLabel = feel === 'hybrid' && batchLabel === 'count'
  const label = describeToolBatch(batch, openTense, countLabel)
  const describedBatch =
    feel === 'hybrid' &&
    batch.calls[0]!.kind === 'terminal' &&
    batch.calls.some((call) => call.description?.trim()) &&
    !(countLabel && label.count !== undefined)
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
          {describedBatch || (tenseText && tenseChange === 'crossfade') ? (
            <TenseText
              holdMs={holdMs}
              count={countLabel ? label.count : undefined}
              active={label.active}
              shimmer
              className={cn(label.failed && 'text-status-error')}
            >
              {label.description ?? `${label.verb} ${label.target}`}
            </TenseText>
          ) : tenseText && !label.description ? (
            <>
              <TenseText holdMs={holdMs} active={label.active} className='shrink-0' shimmer>
                {label.verb}
              </TenseText>
              <TenseText
                count={countLabel ? label.count : undefined}
                holdMs={holdMs}
                active={label.active}
                mono={!label.prose}
              >
                {label.target}
              </TenseText>
            </>
          ) : label.description ? (
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
                <RollingText holdMs={holdMs} className={cn('shrink-0', label.active && 'shimmer')}>
                  {label.verb}
                </RollingText>
              ) : (
                <span className={cn('shrink-0', label.active && 'shimmer')}>{label.verb}</span>
              )}
              <RollingText
                holdMs={holdMs}
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

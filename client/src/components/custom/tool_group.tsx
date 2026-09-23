import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

import { RollingText } from './rolling_text'
import { ToolCall, ToolCallDetails } from './tool_call'
import { describeToolBatch, type ToolBatch } from './work_model'

export function ToolGroup({ batch }: { batch: ToolBatch }) {
  const label = describeToolBatch(batch)
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='activity-header'
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
              <span
                className={cn(
                  'shrink-0',
                  label.active && 'shimmer',
                  label.complete && 'text-foreground'
                )}
              >
                {label.verb}
              </span>
              <RollingText key={label.verb} className='font-mono'>
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

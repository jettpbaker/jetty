import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useStopWorkflow } from '@/state'

import { DisabledTooltip } from './disabled_tooltip'
import { formatSubagentTokens } from './subagent_row'
import {
  FailedCount,
  WorkflowGlyph,
  stopDisabledReason,
  tally,
  waitingCount,
  workflowSeconds,
  workflowStatus,
  type Workflow,
} from './workflow_parts'

export function WorkflowLineGrid({
  threadId,
  workflows,
  onOpen,
  lineClassName,
}: {
  threadId: string
  workflows: readonly Workflow[]
  onOpen: (workflow: Workflow) => void
  lineClassName?: string
}) {
  const stopWorkflow = useStopWorkflow()
  const now = useNow(
    1000,
    workflows.some((workflow) => workflow.status === 'running')
  )
  if (workflows.length === 0) return null
  return (
    <div className='grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-x-3 text-xs'>
      {workflows.map((workflow) => (
        <WorkflowLine
          key={workflow.id}
          workflow={workflow}
          now={now}
          className={lineClassName}
          onOpen={() => onOpen(workflow)}
          onStop={() => stopWorkflow(threadId, workflow.taskId)}
        />
      ))}
    </div>
  )
}

const settledLabel = { completed: 'Finished', failed: 'Failed', stopped: 'Stopped' } as const

function WorkflowLine({
  workflow,
  now,
  className,
  onOpen,
  onStop,
}: {
  workflow: Workflow
  now: number
  className?: string
  onOpen: () => void
  onStop: () => void
}) {
  const status = workflowStatus(workflow)
  const running = status === 'running'
  const { done, failed, total } = tally(workflow.agents)
  const waiting = waitingCount(workflow)
  return (
    <div
      className={cn(
        'group/line relative col-span-full grid h-7 min-w-0 grid-cols-subgrid items-center rounded-sm hover:bg-accent/40',
        className
      )}
    >
      <button
        type='button'
        aria-label={`Show ${workflow.name} in chat`}
        className='absolute inset-0 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
        onClick={onOpen}
      />
      <span className='flex items-center gap-1.5'>
        <WorkflowGlyph workflow={workflow} className='size-3' />
        <span className='text-foreground'>{workflow.name}</span>
      </span>
      <span className='flex min-w-0 gap-3'>
        <span className='truncate text-muted-foreground'>{workflow.description}</span>
        {waiting > 0 && (
          <span className='shrink-0 text-status-attention'>
            {waiting} {waiting === 1 ? 'needs' : 'need'} approval
          </span>
        )}
      </span>
      <span className='justify-self-end text-muted-foreground tabular-nums'>
        {done}/{total} agents done
        <FailedCount failed={failed} />
      </span>
      {running ? (
        <>
          <span className='justify-self-end text-muted-foreground tabular-nums'>
            {formatDuration(workflowSeconds(workflow, now))}
          </span>
          <span className='grid items-center justify-items-end'>
            <span className='text-muted-foreground tabular-nums [grid-area:1/1] group-focus-within/line:opacity-0 group-hover/line:opacity-0'>
              {formatSubagentTokens(workflow.tokens)}
            </span>
            <DisabledTooltip
              reason={stopDisabledReason(workflow)}
              wrap='relative -mr-2.25 flex opacity-0 [grid-area:1/1] group-focus-within/line:opacity-100 group-hover/line:opacity-100'
            >
              <Button
                size='sm'
                variant='ghost'
                className='rounded-sm disabled:pointer-events-none'
                disabled={!!stopDisabledReason(workflow)}
                onClick={onStop}
              >
                Stop
              </Button>
            </DisabledTooltip>
          </span>
        </>
      ) : (
        <>
          <span
            className={cn(
              'justify-self-end',
              status === 'failed' ? 'text-status-error' : 'text-muted-foreground'
            )}
          >
            {settledLabel[status]}
          </span>
          <span className='justify-self-end text-muted-foreground tabular-nums'>
            {formatSubagentTokens(workflow.tokens)}
          </span>
        </>
      )}
    </div>
  )
}

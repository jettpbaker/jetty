import type { ThreadItem } from '@jetty/shared/items'

import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useStopWorkflow } from '@/state'
import { useState } from 'react'

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

// Running workflows, and ones stopped since you last wrote.
function pinnedWorkflows(items: readonly ThreadItem[]) {
  const lastPrompt = items.findLast((item) => item.kind === 'user_message')?.createdAt ?? 0
  return items.filter(
    (item): item is Workflow =>
      item.kind === 'workflow' &&
      (item.status === 'running' ||
        (item.status === 'stopped' && (item.completedAt ?? Infinity) > lastPrompt))
  )
}

// The composer footer's px-2.5, plus its buttons' 1px border and padding, so glyphs and trailing text line up with project and branch.
export function WorkflowLines({
  threadId,
  items,
}: {
  threadId: string
  items: readonly ThreadItem[]
}) {
  return (
    <WorkflowLineGrid
      threadId={threadId}
      workflows={pinnedWorkflows(items)}
      limit={3}
      className='px-2.5'
      lineClassName='pr-2.25 pl-1.75'
    />
  )
}

export function WorkflowLineGrid({
  threadId,
  workflows,
  limit = Infinity,
  onOpen,
  className,
  lineClassName,
}: {
  threadId: string
  workflows: readonly Workflow[]
  limit?: number
  onOpen?: (workflow: Workflow) => void
  className?: string
  lineClassName?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const stopWorkflow = useStopWorkflow()
  const now = useNow(
    1000,
    workflows.some((workflow) => workflow.status === 'running')
  )
  if (workflows.length === 0) return null
  const shown = expanded ? workflows : workflows.slice(0, limit)
  return (
    <div
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-x-3 text-xs',
        className
      )}
    >
      {shown.map((workflow) => (
        <WorkflowLine
          key={workflow.id}
          workflow={workflow}
          now={now}
          className={lineClassName}
          onOpen={onOpen && (() => onOpen(workflow))}
          onStop={() => stopWorkflow(threadId, workflow.taskId)}
        />
      ))}
      {workflows.length > limit && (
        <Button
          variant='ghost-text'
          size='sm'
          className='col-span-full w-fit rounded-sm px-1.5 font-normal'
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show fewer' : `+${workflows.length - limit} more`}
        </Button>
      )}
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
  onOpen?: () => void
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
      {onOpen && (
        <button
          type='button'
          aria-label={`Show ${workflow.name} in chat`}
          className='absolute inset-0 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
          onClick={onOpen}
        />
      )}
      <span className='flex items-center gap-1.5'>
        <WorkflowGlyph workflow={workflow} className='size-3' />
        <span className='text-foreground'>{workflow.name}</span>
      </span>
      <span className='flex min-w-0 gap-3'>
        <span className='truncate text-muted-foreground'>{workflow.description}</span>
        {waiting > 0 && (
          <span className='shrink-0 text-status-attention'>{waiting} needs approval</span>
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

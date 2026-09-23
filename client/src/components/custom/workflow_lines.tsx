import type { ThreadItem } from '@jetty/shared/items'

import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { useStopWorkflow } from '@/state'
import { useState } from 'react'

import { formatDuration, formatSubagentTokens } from './subagent_row'
import {
  WorkflowGlyph,
  tally,
  waitingCount,
  workflowSeconds,
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
  limit = 3,
}: {
  threadId: string
  items: readonly ThreadItem[]
  limit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const stopWorkflow = useStopWorkflow()
  const workflows = pinnedWorkflows(items)
  const now = useNow(
    1000,
    workflows.some((workflow) => workflow.status === 'running')
  )
  if (workflows.length === 0) return null
  const shown = expanded ? workflows : workflows.slice(0, limit)
  return (
    <div className='grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-x-3 px-2.5 text-xs'>
      {shown.map((workflow) => (
        <WorkflowLine
          key={workflow.id}
          workflow={workflow}
          now={now}
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

function WorkflowLine({
  workflow,
  now,
  onStop,
}: {
  workflow: Workflow
  now: number
  onStop: () => void
}) {
  const running = workflow.status === 'running'
  const { done, total } = tally(workflow.agents)
  const waiting = waitingCount(workflow)
  return (
    <div className='group/line relative col-span-full grid h-7 min-w-0 grid-cols-subgrid items-center rounded-sm pr-2.25 pl-1.75 hover:bg-accent/40'>
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
            <Button
              size='sm'
              variant='ghost'
              className='relative -mr-2.25 rounded-sm opacity-0 [grid-area:1/1] group-focus-within/line:opacity-100 group-hover/line:opacity-100'
              onClick={onStop}
            >
              Stop
            </Button>
          </span>
        </>
      ) : (
        <>
          <span className='justify-self-end text-muted-foreground'>Stopped</span>
          <span />
        </>
      )}
    </div>
  )
}

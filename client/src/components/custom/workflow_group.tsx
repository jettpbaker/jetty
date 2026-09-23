import type { WorkflowAgent } from '@jetty/shared/items'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'
import { useStopWorkflow } from '@/state'
import { ChevronRightIcon } from '@primer/octicons-react'

import { DisabledTooltip } from './disabled_tooltip'
import { formatDuration, formatSubagentTokens } from './subagent_row'
import {
  AgentGlyph,
  shownState,
  stopDisabledReason,
  tally,
  workflowSeconds,
  workflowTone,
  type Workflow,
} from './workflow_parts'

const lineGrid = 'grid grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-2'

function agentsIn(workflow: Workflow, index: number) {
  return workflow.agents.filter((agent) => agent.phase === index)
}

function AgentLine({ workflow, agent }: { workflow: Workflow; agent: WorkflowAgent }) {
  const state = shownState(workflow, agent)
  const now = useNow(1000, state === 'active' || state === 'waiting')
  const seconds =
    state === 'active' || state === 'waiting'
      ? agent.startedAt
        ? Math.max(0, now - agent.startedAt) / 1000
        : undefined
      : agent.durationMs != null
        ? agent.durationMs / 1000
        : undefined
  const detail =
    state === 'active' || state === 'waiting'
      ? [agent.lastTool, agent.lastSummary].filter(Boolean).join(' ')
      : state === 'error'
        ? agent.result
        : undefined
  return (
    <div className='col-span-full grid h-7 min-w-0 grid-cols-subgrid items-center gap-x-2 rounded-sm border border-transparent px-2 text-left text-xs'>
      <AgentGlyph state={state} />
      <span
        className={cn(
          'truncate',
          state === 'queued' || state === 'stopped' ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {agent.label}
      </span>
      <span
        className={cn(
          'truncate',
          state === 'waiting'
            ? 'text-status-attention'
            : state === 'error'
              ? 'text-status-error'
              : 'text-muted-foreground'
        )}
      >
        {detail}
      </span>
      <span className='justify-self-end text-muted-foreground tabular-nums'>
        {seconds != null ? formatDuration(seconds) : ''}
        {agent.tokens > 0 && ` · ${formatSubagentTokens(agent.tokens)}`}
      </span>
    </div>
  )
}

function PhaseHeading({
  workflow,
  index,
  title,
}: {
  workflow: Workflow
  index: number
  title: string
}) {
  const { done, total } = tally(agentsIn(workflow, index))
  return (
    <div className='col-span-full flex h-7 items-end gap-2 px-2 pb-1 text-xs'>
      <span className='text-foreground'>{title}</span>
      <span className='text-muted-foreground tabular-nums'>
        {done}/{total}
      </span>
    </div>
  )
}

function AllLines({ workflow }: { workflow: Workflow }) {
  const phased = new Set(workflow.phases.map((phase) => phase.index))
  return (
    <div className={lineGrid}>
      {workflow.phases.map((phase) => (
        <div key={phase.index} className='col-span-full grid grid-cols-subgrid pt-1 first:pt-0'>
          <PhaseHeading workflow={workflow} index={phase.index} title={phase.title} />
          {agentsIn(workflow, phase.index).map((agent) => (
            <AgentLine key={agent.id} workflow={workflow} agent={agent} />
          ))}
        </div>
      ))}
      {workflow.agents
        .filter((agent) => !phased.has(agent.phase))
        .map((agent) => (
          <AgentLine key={agent.id} workflow={workflow} agent={agent} />
        ))}
    </div>
  )
}

export function WorkflowGroup({ threadId, workflow }: { threadId: string; workflow: Workflow }) {
  const stopWorkflow = useStopWorkflow()
  const running = workflow.status === 'running'
  const now = useNow(1000, running)
  const { done, total } = tally(workflow.agents)
  const title = running
    ? 'Running'
    : workflow.status === 'completed'
      ? 'Ran'
      : workflow.status === 'failed'
        ? 'Failed'
        : 'Stopped'
  return (
    <Collapsible defaultOpen={running} className='w-full min-w-0'>
      <CollapsibleTrigger
        render={<Button variant='ghost' />}
        className='group/workflow flex h-auto min-h-9 w-full items-center justify-start gap-2 rounded-sm px-2.5 py-2 text-sm font-normal active:translate-y-0'
      >
        <ChevronRightIcon className='size-3 shrink-0 text-muted-foreground transition-transform duration-(--motion-control-duration) ease-(--motion-control-ease) group-aria-expanded/workflow:rotate-90 motion-reduce:transition-none' />
        <span
          className={cn(
            'shrink-0',
            workflow.status !== 'running' &&
              workflow.status !== 'completed' &&
              workflowTone[workflow.status]
          )}
        >
          {title} workflow
        </span>
        <span className='truncate'>{workflow.name}</span>
        <span className='ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums'>
          <span>
            {done}/{total} agents
          </span>
          <span>
            {running
              ? formatDuration(workflowSeconds(workflow, now))
              : formatSubagentTokens(workflow.tokens)}
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='mt-1 flex flex-col gap-1 pl-5'>
          <AllLines workflow={workflow} />
          <div className='flex h-7 items-center justify-between gap-3 pl-2'>
            <span className='truncate text-xs text-muted-foreground'>{workflow.description}</span>
            {running && (
              <DisabledTooltip reason={stopDisabledReason(workflow)} wrap='flex'>
                <Button
                  size='sm'
                  variant='ghost'
                  className='rounded-sm disabled:pointer-events-none'
                  disabled={!!stopDisabledReason(workflow)}
                  onClick={() => stopWorkflow(threadId, workflow.taskId)}
                >
                  Stop
                </Button>
              </DisabledTooltip>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

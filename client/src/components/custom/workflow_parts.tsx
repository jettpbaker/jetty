import type { ThreadItem, WorkflowAgent } from '@jetty/shared/items'

import { cn } from '@/lib/utils'
import { CircleSlashIcon } from '@primer/octicons-react'

import { ErrorStatusIcon, NeedsInputIcon, SuccessStatusIcon } from './circle_status_icon'
import { InProgressIcon } from './in_progress_icon'

export type Workflow = Extract<ThreadItem, { kind: 'workflow' }>

export function tally(agents: readonly WorkflowAgent[]) {
  return {
    done: agents.filter((agent) => agent.state === 'done').length,
    failed: agents.filter((agent) => agent.state === 'error').length,
    total: agents.length,
  }
}

// Providers can report a workflow complete even when every agent failed.
export function workflowStatus(workflow: Workflow): Workflow['status'] {
  const { done, failed } = tally(workflow.agents)
  return workflow.status === 'completed' && failed > 0 && done === 0 ? 'failed' : workflow.status
}

export function FailedCount({ failed }: { failed: number }) {
  return failed > 0 && <span className='text-status-error'> · {failed} failed</span>
}

export function workflowSeconds(workflow: Workflow, now: number) {
  const ms =
    workflow.status === 'running'
      ? now - workflow.createdAt
      : workflow.durationMs || (workflow.completedAt ?? now) - workflow.createdAt
  return Math.max(0, ms) / 1000
}

export type ShownState = WorkflowAgent['state'] | 'stopped'

export function shownState(workflow: Workflow, agent: WorkflowAgent): ShownState {
  if (workflow.status === 'stopped' && (agent.state === 'active' || agent.state === 'waiting'))
    return 'stopped'
  return agent.state
}

export const workflowTone: Record<Workflow['status'], string> = {
  running: 'text-status-working',
  completed: 'text-status-success',
  failed: 'text-status-error',
  stopped: 'text-muted-foreground',
}

// Grok's ACP has no per-workflow stop request.
export function stopDisabledReason(workflow: Workflow) {
  return workflow.provider === 'grok' ? 'Grok can’t stop a single workflow' : undefined
}

export function waitingCount(workflow: Workflow) {
  return workflow.status === 'running'
    ? workflow.agents.filter((agent) => agent.state === 'waiting').length
    : 0
}

export function WorkflowGlyph({ workflow, className }: { workflow: Workflow; className?: string }) {
  const status = workflowStatus(workflow)
  if (status === 'running')
    return (
      <InProgressIcon
        aria-hidden='true'
        className={cn('size-3.5 shrink-0 text-status-working', className)}
      />
    )
  return (
    <AgentGlyph
      state={status === 'completed' ? 'done' : status === 'failed' ? 'error' : 'stopped'}
      className={className}
    />
  )
}

export function AgentGlyph({ state, className }: { state: ShownState; className?: string }) {
  const box = cn('flex size-3.5 shrink-0 items-center justify-center', className)
  if (state === 'done')
    return (
      <span className={cn(box, 'text-status-success')}>
        <SuccessStatusIcon className='size-3.5' />
      </span>
    )
  if (state === 'error')
    return (
      <span className={cn(box, 'text-status-error')}>
        <ErrorStatusIcon className='size-3.5' />
      </span>
    )
  if (state === 'waiting')
    return (
      <span className={cn(box, 'text-status-attention')}>
        <NeedsInputIcon className='size-3.5' />
      </span>
    )
  if (state === 'stopped')
    return (
      <span className={cn(box, 'text-muted-foreground')}>
        <CircleSlashIcon className='size-3' />
      </span>
    )
  if (state === 'active')
    return (
      <span className={cn(box, 'text-status-working')}>
        <InProgressIcon className='size-3.5' />
      </span>
    )
  return (
    <span className={box}>
      <span className='size-2 rounded-full border border-muted-foreground' />
    </span>
  )
}

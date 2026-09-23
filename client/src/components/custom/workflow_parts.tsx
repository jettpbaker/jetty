import type { ThreadItem, WorkflowAgent } from '@jetty/shared/items'

import { StatusGlyph, type Status } from './thread_status'

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

const agentStatus: Record<ShownState, Status> = {
  queued: 'queued',
  active: 'working',
  waiting: 'needs-attention',
  done: 'done',
  error: 'error',
  stopped: 'stopped',
}

const workflowGlyphStatus: Record<Workflow['status'], Status> = {
  running: 'working',
  completed: 'done',
  failed: 'error',
  stopped: 'stopped',
}

export function WorkflowGlyph({ workflow, className }: { workflow: Workflow; className?: string }) {
  return (
    <StatusGlyph status={workflowGlyphStatus[workflowStatus(workflow)]} className={className} />
  )
}

export function AgentGlyph({ state, className }: { state: ShownState; className?: string }) {
  return <StatusGlyph status={agentStatus[state]} className={className} />
}

import type { ContextUsage, ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'

import { createAcpTranslator } from './acp-translate'
import { object, string } from './stdio-rpc'

export function createGrokTranslator(
  turnId: string,
  workflows = new Set<string>(),
  subagents = new Map<string, string>(),
  background = new Map<string, string>(),
  backgroundTools = new Set<string>()
) {
  const hiddenTools = new Set<string>()
  const subagentPrompts = new Map<string, string>()
  const standard = createAcpTranslator(turnId, {
    toolName: grokToolName,
    toolInput: (update) => grokToolInput(update.rawInput),
    toolOutput: grokToolOutput,
    hideTool(update) {
      const key = string(update.toolCallId)
      if (backgroundTools.has(key)) return true
      // Workflows and todo_write have their own updates: workflow_updated and plan.
      const input = object(update.rawInput)
      if (input.variant === 'Task')
        subagentPrompts.set(string(input.description), string(input.prompt))
      const name = grokToolName(update).toLowerCase()
      if (name === 'workflow' || name === 'todo_write') hiddenTools.add(key)
      const outputType = object(update.rawOutput).type
      if (outputType === 'BackgroundTaskStarted' || outputType === 'Monitor')
        backgroundTools.add(key)
      if (hiddenTools.has(key) || outputType === 'Workflow' || outputType === 'Todo') return true
      return false
    },
  })
  const { tools, closeText } = standard
  let compactionId: string | undefined

  function endBackground(taskId: string): ThreadEvent[] {
    const id = background.get(taskId)
    if (!id) return []
    background.delete(taskId)
    return [{ type: 'item.completed', itemId: id, patch: { endedAt: Date.now() } }]
  }

  function translate(update: Record<string, unknown>): ThreadEvent[] {
    const events: ThreadEvent[] = []
    const base = { turnId, createdAt: Date.now() }
    if (update.sessionUpdate === 'task_backgrounded') {
      const taskId = string(update.task_id)
      if (!taskId || background.has(taskId)) return events
      const id = newId()
      const monitor = string(update.monitor_description)
      const toolCallId = string(update.tool_call_id)
      if (toolCallId) backgroundTools.add(toolCallId)
      const tool = tools.get(toolCallId)
      if (tool && !tool.done) {
        tool.done = true
        events.push({ type: 'item.completed', itemId: tool.id, patch: { status: 'succeeded' } })
      }
      background.set(taskId, id)
      events.push({
        type: 'item.started',
        item: {
          ...base,
          id,
          kind: 'background',
          taskId,
          task: monitor ? 'monitor' : 'command',
          label: monitor || string(update.command) || string(update.description),
        },
      })
      return events
    }
    if (update.sessionUpdate === 'task_completed')
      return endBackground(string(object(update.task_snapshot).task_id))
    if (update.sessionUpdate === 'background_tasks') {
      const tasks = (Array.isArray(update.tasks) ? update.tasks.map(object) : []).filter(
        (task) => task.status === 'running' && string(task.task_id)
      )
      const live = new Set(tasks.map((task) => string(task.task_id)))
      for (const task of tasks) {
        const taskId = string(task.task_id)
        if (background.has(taskId)) continue
        const id = newId()
        const monitor = task.kind === 'monitor'
        background.set(taskId, id)
        events.push({
          type: 'item.started',
          item: {
            ...base,
            createdAt: Date.parse(string(task.started_at)) || base.createdAt,
            id,
            kind: 'background',
            taskId,
            task: monitor ? 'monitor' : 'command',
            label: monitor ? string(task.description) : string(task.command),
          },
        })
      }
      return [
        ...events,
        ...[...background.keys()].flatMap((id) => (live.has(id) ? [] : endBackground(id))),
      ]
    }
    if (update.sessionUpdate === 'auto_compact_started') {
      if (compactionId) return events
      compactionId = newId()
      events.push({
        type: 'item.started',
        item: { ...base, id: compactionId, kind: 'compaction', status: 'running' },
      })
      return events
    }
    if (
      update.sessionUpdate === 'auto_compact_completed' ||
      update.sessionUpdate === 'auto_compact_failed' ||
      update.sessionUpdate === 'auto_compact_cancelled'
    ) {
      const status = update.sessionUpdate === 'auto_compact_completed' ? 'completed' : 'failed'
      if (compactionId)
        events.push({ type: 'item.completed', itemId: compactionId, patch: { status } })
      else if (status === 'completed')
        events.push({
          type: 'item.started',
          item: { ...base, id: newId(), kind: 'compaction', status },
        })
      compactionId = undefined
      return events
    }
    if (update.sessionUpdate === 'subagent_spawned') {
      const taskId = string(update.subagent_id)
      if (!taskId || subagents.has(taskId)) return events
      const id = newId()
      const title = string(update.description) || 'Subagent'
      subagents.set(taskId, id)
      events.push(...closeText(), {
        type: 'item.started',
        item: {
          ...base,
          id,
          kind: 'subagent',
          taskId,
          title,
          prompt: subagentPrompts.get(title) ?? '',
          agentType: string(update.subagent_type) || undefined,
          model: string(update.model) || undefined,
          status: 'running',
        },
      })
      return events
    }
    if (
      update.sessionUpdate === 'subagent_progress' ||
      update.sessionUpdate === 'subagent_finished'
    ) {
      const id = subagents.get(string(update.subagent_id))
      if (!id) return events
      const finished = update.sessionUpdate === 'subagent_finished'
      events.push({
        type: finished ? 'item.completed' : 'item.updated',
        itemId: id,
        patch: {
          ...(finished
            ? {
                status:
                  update.status === 'failed' || update.status === 'error'
                    ? 'failed'
                    : ['stopped', 'interrupted', 'cancelled'].includes(string(update.status))
                      ? 'stopped'
                      : 'completed',
                result: string(update.output),
              }
            : {}),
          tokens: natural(update.tokens_used),
          durationMs: natural(update.duration_ms),
        },
      })
      return events
    }
    if (update.sessionUpdate === 'workflow_updated') {
      const runId = string(update.run_id)
      if (!runId) return events
      const phaseNames = new Set<string>()
      if (string(update.current_phase)) phaseNames.add(string(update.current_phase))
      const members = Array.isArray(update.agents) ? update.agents.map(object) : []
      for (const member of members) if (string(member.phase)) phaseNames.add(string(member.phase))
      const phases = [...phaseNames].map((title, index) => ({ index, title }))
      const agents = members.map((member, index) => ({
        id: string(member.agent_id) || String(index),
        label: string(member.label) || 'Agent',
        phase: Math.max(
          0,
          phases.findIndex((phase) => phase.title === string(member.phase))
        ),
        ...(string(member.model) ? { model: string(member.model) } : {}),
        state:
          member.state === 'done' || member.state === 'completed'
            ? ('done' as const)
            : member.state === 'error' || member.state === 'failed'
              ? ('error' as const)
              : member.state === 'active' || member.state === 'running'
                ? ('active' as const)
                : member.state === 'waiting'
                  ? ('waiting' as const)
                  : ('queued' as const),
        tokens: natural(member.tokens_used),
        toolCalls: natural(member.tool_calls),
        ...(string(member.output) ? { result: string(member.output) } : {}),
        ...(typeof member.duration_ms === 'number'
          ? { durationMs: natural(member.duration_ms) }
          : {}),
      }))
      const status =
        update.status === 'complete' || update.status === 'completed'
          ? ('completed' as const)
          : update.status === 'failed' || update.status === 'error'
            ? ('failed' as const)
            : update.status === 'stopped' || update.status === 'interrupted'
              ? ('stopped' as const)
              : ('running' as const)
      const patch = {
        name: string(update.name) || 'Workflow',
        description: string(update.objective),
        status,
        phases,
        agents,
        tokens: agents.reduce((sum, agent) => sum + agent.tokens, 0),
        durationMs: natural(update.elapsed_ms),
        ...(string(update.result_summary) ? { summary: string(update.result_summary) } : {}),
      }
      const fresh = !workflows.has(runId)
      if (fresh) {
        workflows.add(runId)
        events.push({
          type: 'item.started',
          item: {
            ...base,
            id: runId,
            kind: 'workflow',
            taskId: runId,
            runId,
            provider: 'grok',
            ...patch,
          },
        })
      }
      if (!fresh || status !== 'running')
        events.push({
          type: status === 'running' ? 'item.updated' : 'item.completed',
          itemId: runId,
          patch,
        })
      return events
    }
    return standard.translate(update)
  }

  function endAllBackground() {
    return [...background.keys()].flatMap(endBackground)
  }
  return {
    translate,
    finish: standard.finish,
    workflows,
    subagents,
    background,
    backgroundTools,
    endAllBackground,
    toolItemId: standard.toolItemId,
  }
}

// `_x.ai/session/info` backs Grok's /context: `used` is the last request's prompt size.
export function grokContextUsage(info: Record<string, unknown>): ContextUsage | null {
  const context = object(info.context)
  const usedTokens = natural(context.used)
  const maxTokens = natural(context.total)
  if (usedTokens <= 0 || maxTokens <= 0) return null
  const compactPercent = natural(context.autoCompactThresholdPercent)
  return {
    usedTokens,
    maxTokens,
    ...(compactPercent > 0 ? { compactAt: Math.round((maxTokens * compactPercent) / 100) } : {}),
    slices: [],
    asOf: Date.now(),
  }
}

function natural(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

// Grok runs MCP tools through a UseTool wrapper named `server__tool`.
function grokMcpTool(rawInput: unknown) {
  const input = object(rawInput)
  const [server, ...tool] = string(input.tool_name).split('__')
  if (input.variant !== 'UseTool' || !server || !tool.length) return undefined
  return { name: `mcp__${server}__${tool.join('__')}`, input: input.tool_input ?? {} }
}

function grokToolInput(rawInput: unknown) {
  return grokMcpTool(rawInput)?.input ?? rawInput
}

function grokToolName(update: Record<string, unknown>): string {
  const mcp = grokMcpTool(update.rawInput)
  if (mcp) return mcp.name
  switch (update.kind ?? object(object(update._meta)['x.ai/tool']).kind) {
    case 'read':
      return 'Read'
    case 'edit':
      return 'Edit'
    case 'execute':
      return 'Bash'
    case 'search':
      return 'Grep'
    case 'fetch':
      return 'WebFetch'
    default:
      return string(update.title) || string(update.kind) || 'Tool'
  }
}

function grokToolOutput(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return grokToolOutput(JSON.parse(value))
    } catch {
      return value
    }
  }
  if (Array.isArray(value)) return value.map(grokToolOutput).filter(Boolean).join('\n')
  const output = object(value)
  if (typeof output.OkayOutput === 'string') return output.OkayOutput
  if (typeof output.output_for_prompt === 'string') return output.output_for_prompt
  if (typeof output.text === 'string') return output.text
  if (output.output !== undefined) return grokToolOutput(output.output)
  return value == null ? '' : JSON.stringify(value)
}

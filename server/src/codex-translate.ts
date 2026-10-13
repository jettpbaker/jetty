import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import { newId } from '@jetty/shared/wire'

import { object, string, type RpcMessage } from './stdio-rpc'

export function createCodexTranslator(turnId: string) {
  const items = new Map<string, ThreadItem>()
  const completed = new Set<string>()
  const reasoning = new Map<string, { summary: string[]; content: string[] }>()
  // ids handed out for items Codex hasn't started yet (an approval comes before its command)
  const reserved = new Map<string, string>()

  function itemFrom(raw: Record<string, unknown>): ThreadItem | undefined {
    const base = { id: reserved.get(string(raw.id)) ?? newId(), turnId, createdAt: Date.now() }
    switch (raw.type) {
      case 'agentMessage':
        return { ...base, kind: 'assistant_message', text: string(raw.text), streaming: true }
      case 'reasoning':
        return {
          ...base,
          kind: 'reasoning',
          text: textArray(raw.summary) || textArray(raw.content),
          streaming: true,
        }
      case 'plan':
        return { ...base, kind: 'plan', text: string(raw.text), streaming: true }
      case 'userMessage':
      case 'hookPrompt':
      case 'functionCallOutput':
      case 'subAgentActivity':
      case 'enteredReviewMode':
      case 'exitedReviewMode':
        return undefined
      case 'contextCompaction':
        return { ...base, kind: 'compaction', status: 'running' }
      default:
        return {
          ...base,
          kind: 'tool_call',
          toolName: toolName(raw),
          input: toolInput(raw),
          output: '',
          status: 'running',
        }
    }
  }

  function translate(message: RpcMessage): ThreadEvent[] {
    const { method, params } = message
    const events: ThreadEvent[] = []
    if (method === 'item/started' || method === 'item/completed') {
      const raw = object(params.item)
      const id = string(raw.id)
      if (!id) return events
      let item = items.get(id)
      if (!item) {
        item = itemFrom(raw)
        if (!item) return events
        items.set(id, item)
        if (raw.type === 'reasoning') reasoning.set(id, { summary: [], content: [] })
        events.push({ type: 'item.started', item })
      }
      if (method === 'item/completed') {
        completed.add(id)
        const fileChange = fileChangeCounts(raw)
        const patch =
          item.kind === 'tool_call'
            ? {
                toolName: toolName(raw),
                input: toolInput(raw),
                status:
                  raw.status === 'failed' ||
                  raw.status === 'declined' ||
                  raw.success === false ||
                  (typeof raw.exitCode === 'number' && raw.exitCode !== 0)
                    ? 'failed'
                    : 'succeeded',
                output:
                  typeof raw.aggregatedOutput === 'string' ? raw.aggregatedOutput : toolOutput(raw),
                ...(fileChange ? { fileChange } : {}),
              }
            : item.kind === 'compaction'
              ? { status: raw.status === 'failed' ? 'failed' : 'completed' }
              : {
                  streaming: false,
                  ...(raw.type === 'reasoning'
                    ? { text: textArray(raw.summary) || textArray(raw.content) }
                    : typeof raw.text === 'string'
                      ? { text: raw.text }
                      : {}),
                }
        events.push({ type: 'item.completed', itemId: item.id, patch })
      }
    } else if (method === 'item/fileChange/patchUpdated') {
      const item = items.get(string(params.itemId))
      if (item?.kind === 'tool_call')
        events.push({
          type: 'item.updated',
          itemId: item.id,
          patch: {
            input: toolInput({ ...params, type: 'fileChange' }),
            output: toolOutput({ ...params, type: 'fileChange' }),
          },
        })
    } else if (
      method === 'item/agentMessage/delta' ||
      method === 'item/reasoning/summaryTextDelta' ||
      method === 'item/reasoning/textDelta' ||
      method === 'item/plan/delta' ||
      method === 'item/commandExecution/outputDelta' ||
      method === 'item/fileChange/outputDelta'
    ) {
      const item = items.get(string(params.itemId))
      if (item && typeof params.delta === 'string') {
        const parts = reasoning.get(string(params.itemId))
        if (parts) {
          const summary = method === 'item/reasoning/summaryTextDelta'
          const target = summary ? parts.summary : parts.content
          const index = natural(summary ? params.summaryIndex : params.contentIndex)
          target[index] = (target[index] ?? '') + params.delta
          events.push({
            type: 'item.updated',
            itemId: item.id,
            patch: { text: textArray(parts.summary) || textArray(parts.content) },
          })
        } else events.push({ type: 'item.delta', itemId: item.id, delta: params.delta })
      }
    } else if (method === 'item/mcpToolCall/progress') {
      const item = items.get(string(params.itemId))
      if (item && string(params.message))
        events.push({ type: 'item.delta', itemId: item.id, delta: `${params.message}\n` })
    } else if (method === 'error' && params.willRetry === true) {
      events.push({
        type: 'item.started',
        item: {
          id: newId(),
          turnId,
          createdAt: Date.now(),
          kind: 'error',
          message: `Codex is retrying: ${string(object(params.error).message) || 'Request failed'}`,
        },
      })
    } else if (method === 'turn/plan/updated' && Array.isArray(params.plan)) {
      // Mirrors Claude's TodoWrite input so one reader serves both providers.
      const todos = params.plan.map(object).map((step) => ({
        content: string(step.step),
        status: step.status === 'inProgress' ? 'in_progress' : string(step.status),
      }))
      const item: ThreadItem = {
        id: newId(),
        turnId,
        createdAt: Date.now(),
        kind: 'tool_call',
        toolName: 'update_plan',
        input: { todos },
        output: '',
        status: 'running',
      }
      events.push(
        { type: 'item.started', item },
        { type: 'item.completed', itemId: item.id, patch: { status: 'succeeded' } }
      )
    } else if (method === 'thread/tokenUsage/updated') {
      const tokenUsage = object(params.tokenUsage)
      const last = object(tokenUsage.last)
      const maxTokens = natural(tokenUsage.modelContextWindow)
      if (maxTokens > 0)
        events.push({
          type: 'context.updated',
          usage: { usedTokens: natural(last.totalTokens), maxTokens, slices: [], asOf: Date.now() },
        })
    }
    return events
  }

  // A tool cut off by Stop didn't fail: left unsettled, it reads as stopped, as Claude's do.
  function finish(stopped = false): ThreadEvent[] {
    const events: ThreadEvent[] = []
    for (const [id, item] of items) {
      if (completed.has(id)) continue
      completed.add(id)
      events.push(
        item.kind !== 'tool_call'
          ? { type: 'item.completed', itemId: item.id, patch: { streaming: false } }
          : stopped
            ? { type: 'item.completed', itemId: item.id }
            : { type: 'item.completed', itemId: item.id, patch: { status: 'failed' } }
      )
    }
    return events
  }

  function toolItemId(codexId: string) {
    const known = items.get(codexId)?.id ?? reserved.get(codexId)
    if (known) return known
    const id = newId()
    reserved.set(codexId, id)
    return id
  }

  return { translate, finish, toolItemId }
}

function toolName(raw: Record<string, unknown>): string {
  switch (raw.type) {
    case 'commandExecution':
      switch (commandAction(raw)?.type) {
        case 'read':
          return 'Read'
        case 'search':
          return 'Grep'
        case 'listFiles':
          return 'Glob'
        default:
          return 'Bash'
      }
    case 'fileChange':
      return 'Edit'
    case 'webSearch':
      return object(raw.action).type === 'openPage' || object(raw.action).type === 'findInPage'
        ? 'WebFetch'
        : 'WebSearch'
    case 'imageView':
      return 'Read'
    case 'imageGeneration':
      return 'ImageGen'
    case 'sleep':
      return 'Sleep'
    case 'mcpToolCall':
      return `mcp__${string(raw.server)}__${string(raw.tool)}`
    case 'dynamicToolCall':
      return [string(raw.namespace), string(raw.tool)].filter(Boolean).join('__') || 'Tool'
    case 'collabAgentToolCall':
      return string(raw.tool) || 'Task'
    default:
      return string(raw.tool) || 'Tool'
  }
}

function toolInput(raw: Record<string, unknown>): unknown {
  switch (raw.type) {
    case 'commandExecution':
      return { command: raw.command, cwd: raw.cwd, ...commandAction(raw) }
    case 'fileChange': {
      const changes = Array.isArray(raw.changes) ? raw.changes.map(object) : []
      return { path: string(changes[0]?.path), changes }
    }
    case 'webSearch':
      return {
        query: raw.query,
        action: raw.action,
        ...(object(raw.action).url ? { url: object(raw.action).url } : {}),
      }
    case 'imageView':
      return { path: raw.path }
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return raw.arguments ?? {}
    case 'collabAgentToolCall':
      return { prompt: raw.prompt, agents: raw.receiverThreadIds }
    default:
      return raw
  }
}

function toolOutput(raw: Record<string, unknown>): string {
  if (raw.type === 'fileChange' && Array.isArray(raw.changes)) {
    return raw.changes
      .map(object)
      .map((change) => {
        return [string(change.path), string(change.diff)].filter(Boolean).join('\n')
      })
      .join('\n\n')
  }
  const result = object(raw.result)
  if (Array.isArray(result.content))
    return result.content
      .map(object)
      .map((part) => string(part.text))
      .filter(Boolean)
      .join('\n')
  if (Array.isArray(raw.contentItems))
    return raw.contentItems
      .map(object)
      .map((part) => string(part.text))
      .filter(Boolean)
      .join('\n')
  if (raw.error) return string(object(raw.error).message) || JSON.stringify(raw.error)
  if (Array.isArray(raw.results)) return JSON.stringify(raw.results)
  return ''
}

function commandAction(raw: Record<string, unknown>) {
  return Array.isArray(raw.commandActions) && raw.commandActions.length === 1
    ? object(raw.commandActions[0])
    : undefined
}

function fileChangeCounts(raw: Record<string, unknown>) {
  if (raw.type !== 'fileChange' || !Array.isArray(raw.changes) || raw.changes.length !== 1)
    return undefined
  const change = object(raw.changes[0])
  const path = string(change.path)
  const diff = string(change.diff)
  if (!path) return undefined
  const kind = object(change.kind).type
  const lines = diff ? diff.split('\n').length - Number(diff.endsWith('\n')) : 0
  if (kind === 'add') return { path, additions: lines, deletions: 0 }
  if (kind === 'delete') return { path, additions: 0, deletions: lines }
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { path, additions, deletions }
}

function textArray(value: unknown): string {
  return Array.isArray(value) ? value.filter((part) => typeof part === 'string').join('\n\n') : ''
}

function natural(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

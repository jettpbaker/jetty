import type { ContextUsage, ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'

import { createAcpTranslator } from './acp-translate'
import { object, string } from './stdio-rpc'

export function copilotToolName(update: Record<string, unknown>) {
  const title = string(update.title)
  const mcp = /^(?:mcp__)?jetty(?:__|[-_:])([a-z_]+)$/.exec(title)
  if (mcp) return `mcp__jetty__${mcp[1]}`
  switch (update.kind) {
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
      return title || string(update.kind) || 'Tool'
  }
}

export function copilotToolInput(update: Record<string, unknown>) {
  const input = object(update.rawInput)
  const locations = Array.isArray(update.locations) ? update.locations.map(object) : []
  const content = Array.isArray(update.content) ? update.content.map(object) : []
  const changes = content
    .filter((item) => item.type === 'diff')
    .map((item) => ({
      path: string(item.path),
      before: string(item.oldText),
      after: string(item.newText),
    }))
  const path =
    string(input.file_path) ||
    string(input.path) ||
    string(input.fileName) ||
    string(locations[0]?.path)
  return {
    ...input,
    ...(path ? { file_path: path } : {}),
    ...(typeof input.file_text === 'string' ? { content: input.file_text } : {}),
    ...(changes.length ? { changes } : {}),
    ...(locations.length ? { locations } : {}),
    ...(update.kind ? { kind: update.kind } : {}),
  }
}

function copilotToolOutput(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(copilotToolOutput).filter(Boolean).join('\n')
  const output = object(value)
  if (output.type === 'diff') return ''
  if (typeof output.text === 'string') return output.text
  if (output.content !== undefined) return copilotToolOutput(output.content)
  if (output.output !== undefined) return copilotToolOutput(output.output)
  return value == null ? '' : JSON.stringify(value)
}

export function copilotContextUsage(update: Record<string, unknown>): ContextUsage | null {
  if (update.sessionUpdate !== 'usage_update') return null
  const usedTokens = update.used
  const maxTokens = update.size
  if (
    typeof usedTokens !== 'number' ||
    typeof maxTokens !== 'number' ||
    !Number.isFinite(usedTokens) ||
    !Number.isFinite(maxTokens) ||
    usedTokens < 0 ||
    maxTokens <= 0
  )
    return null
  return {
    usedTokens: Math.floor(usedTokens),
    maxTokens: Math.floor(maxTokens),
    slices: [],
    asOf: Date.now(),
  }
}

export function createCopilotTranslator(turnId: string) {
  const tools = new Map<string, Record<string, unknown>>()
  const standard = createAcpTranslator(turnId, {
    toolName: copilotToolName,
    toolInput: copilotToolInput,
    toolOutput: copilotToolOutput,
  })
  let compactionId: string | undefined
  function translate(update: Record<string, unknown>): ThreadEvent[] {
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const key = string(update.toolCallId)
      const merged = { ...tools.get(key), ...update }
      tools.set(key, merged)
      return standard.translate(merged)
    }
    if (update.sessionUpdate === 'compaction') {
      if (update.status === 'in_progress') {
        if (compactionId) return []
        compactionId = newId()
        return [
          ...standard.closeText(),
          {
            type: 'item.started',
            item: {
              id: compactionId,
              turnId,
              createdAt: Date.now(),
              kind: 'compaction',
              status: 'running',
            },
          },
        ]
      }
      if (compactionId && (update.status === 'completed' || update.status === 'failed')) {
        const itemId = compactionId
        compactionId = undefined
        return [{ type: 'item.completed', itemId, patch: { status: update.status } }]
      }
    }
    return standard.translate(update)
  }
  function finish(stopped = false): ThreadEvent[] {
    const events = standard.finish(stopped)
    if (compactionId)
      events.push({
        type: 'item.completed',
        itemId: compactionId,
        patch: { status: stopped ? 'running' : 'failed' },
      })
    compactionId = undefined
    return events
  }
  return { translate, finish, toolItemId: standard.toolItemId }
}

import type { ContextUsage, ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'
import { parsePatchFiles } from '@pierre/diffs'

import { createAcpTranslator } from './acp-translate'
import { SELF_TOOLS, THREAD_TOOLS } from './jetty-tools'
import { object, string } from './stdio-rpc'

export function copilotToolName(update: Record<string, unknown>) {
  const title = string(update.title)
  const mcp = /^(?:mcp__)?jetty(?:__|[-_:])([a-z_]+)$/.exec(title)
  if (mcp) return `mcp__jetty__${mcp[1]}`
  if ([...SELF_TOOLS, ...THREAD_TOOLS].some((name) => name === title)) return `mcp__jetty__${title}`
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
  if (typeof output.detailedContent === 'string') return output.detailedContent
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
  function translate(update: Record<string, unknown>): ThreadEvent[] {
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const key = string(update.toolCallId)
      const previous = tools.get(key)
      const name = previous && copilotToolName(previous)
      const merged: Record<string, unknown> = {
        ...previous,
        ...update,
        ...(name?.startsWith('mcp__') ? { title: name } : {}),
      }
      tools.set(key, merged)
      const events = standard.translate(merged)
      const diff = string(object(merged.rawOutput).detailedContent)
      const path = string(copilotToolInput(merged).file_path)
      if (merged.kind === 'edit' && diff && path) {
        const files = parsePatchFiles(diff).flatMap((patch) => patch.files)
        if (files.length === 1) {
          const hunks = files[0]!.hunks
          events.push({
            type: 'item.updated',
            itemId: standard.toolItemId(key),
            patch: {
              fileChange: {
                path,
                additions: hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0),
                deletions: hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0),
              },
            },
          })
        }
      }
      return events
    }
    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      /^Compacted conversation history and removed \d+ messages and [\d,]+ tokens\.$/.test(
        string(object(update.content).text)
      )
    )
      return [
        ...standard.closeText(),
        {
          type: 'item.started',
          item: {
            id: newId(),
            turnId,
            createdAt: Date.now(),
            kind: 'compaction',
            status: 'completed',
          },
        },
      ]
    return standard.translate(update)
  }
  return { translate, finish: standard.finish, toolItemId: standard.toolItemId }
}

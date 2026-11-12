import type { ThreadEvent } from '@jetty/shared/events'

import { acpToolName, createAcpTranslator } from './acp-translate'
import { object, string } from './stdio-rpc'

export function opencodeToolInput(update: Record<string, unknown>) {
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
    string(input.filePath) ||
    string(input.filepath) ||
    string(input.file_path) ||
    string(input.path) ||
    string(locations[0]?.path)
  return {
    ...input,
    ...(path ? { file_path: path } : {}),
    ...(typeof input.oldString === 'string' ? { old_string: input.oldString } : {}),
    ...(typeof input.newString === 'string' ? { new_string: input.newString } : {}),
    ...(changes.length ? { changes } : {}),
    ...(locations.length ? { locations } : {}),
    ...(update.kind ? { kind: update.kind } : {}),
  }
}

function opencodeToolOutput(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(opencodeToolOutput).filter(Boolean).join('\n')
  const output = object(value)
  if (output.type === 'diff' || output.type === 'image') return ''
  if (typeof output.text === 'string') return output.text
  if (typeof output.error === 'string') return output.error
  if (output.content !== undefined) return opencodeToolOutput(output.content)
  if (output.output !== undefined) return opencodeToolOutput(output.output)
  return value == null ? '' : JSON.stringify(value)
}

export function createOpencodeTranslator(turnId: string) {
  const tools = new Map<string, Record<string, unknown>>()
  const standard = createAcpTranslator(turnId, {
    toolName: acpToolName,
    toolInput: opencodeToolInput,
    toolOutput: opencodeToolOutput,
  })
  function translate(update: Record<string, unknown>): ThreadEvent[] {
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const key = string(update.toolCallId)
      const previous = tools.get(key)
      const name = previous && acpToolName(previous)
      const merged: Record<string, unknown> = {
        ...previous,
        ...update,
        ...(name?.startsWith('mcp__') ? { title: name } : {}),
      }
      tools.set(key, merged)
      return standard.translate(merged)
    }
    return standard.translate(update)
  }
  return {
    translate,
    finish: standard.finish,
    toolItemId: standard.toolItemId,
    toolInput: (id: string) => opencodeToolInput(tools.get(id) ?? {}),
  }
}

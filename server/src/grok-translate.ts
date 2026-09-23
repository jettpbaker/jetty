import type { ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'

import { object, string } from './stdio-rpc'

export function createGrokTranslator(turnId: string) {
  const tools = new Map<string, { id: string; done: boolean }>()
  let text: { id: string; kind: 'assistant_message' | 'reasoning' } | undefined

  function closeText(): ThreadEvent[] {
    if (!text) return []
    const event: ThreadEvent = {
      type: 'item.completed',
      itemId: text.id,
      patch: { streaming: false },
    }
    text = undefined
    return [event]
  }

  function translate(update: Record<string, unknown>): ThreadEvent[] {
    const events: ThreadEvent[] = []
    const base = { turnId, createdAt: Date.now() }
    if (
      update.sessionUpdate === 'agent_message_chunk' ||
      update.sessionUpdate === 'agent_thought_chunk'
    ) {
      const content = object(update.content)
      if (content.type !== 'text' || typeof content.text !== 'string') return events
      const kind =
        update.sessionUpdate === 'agent_message_chunk' ? 'assistant_message' : 'reasoning'
      if (text?.kind !== kind) {
        events.push(...closeText())
        text = { id: newId(), kind }
        events.push({ type: 'item.started', item: { ...base, ...text, text: '', streaming: true } })
      }
      events.push({ type: 'item.delta', itemId: text!.id, delta: content.text })
    } else if (
      update.sessionUpdate === 'tool_call' ||
      update.sessionUpdate === 'tool_call_update'
    ) {
      const key = string(update.toolCallId)
      if (!key) return events
      events.push(...closeText())
      let tool = tools.get(key)
      if (tool?.done) return events
      if (!tool) {
        tool = { id: newId(), done: false }
        tools.set(key, tool)
        events.push({
          type: 'item.started',
          item: {
            ...base,
            id: tool.id,
            kind: 'tool_call',
            toolName: grokToolName(update),
            input: update.rawInput ?? {},
            output: '',
            status: 'running',
          },
        })
      }
      const done = update.status === 'completed' || update.status === 'failed'
      tool.done = done
      events.push({
        type: 'item.completed',
        itemId: tool.id,
        patch: {
          ...(update.kind === undefined ? {} : { toolName: grokToolName(update) }),
          ...(update.rawInput === undefined ? {} : { input: update.rawInput }),
          ...(update.rawOutput === undefined && update.content === undefined
            ? {}
            : {
                output: grokToolOutput(update.rawOutput ?? update.content),
              }),
          status: done ? (update.status === 'failed' ? 'failed' : 'succeeded') : 'running',
        },
      })
    }
    return events
  }

  function finish(): ThreadEvent[] {
    const events = closeText()
    for (const tool of tools.values()) {
      if (tool.done) continue
      tool.done = true
      events.push({ type: 'item.completed', itemId: tool.id, patch: { status: 'failed' } })
    }
    return events
  }
  return { translate, finish }
}

function grokToolName(update: Record<string, unknown>): string {
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
  if (typeof output.output_for_prompt === 'string') return output.output_for_prompt
  if (typeof output.text === 'string') return output.text
  if (output.output !== undefined) return grokToolOutput(output.output)
  return value == null ? '' : JSON.stringify(value)
}

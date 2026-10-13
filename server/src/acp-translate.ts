import type { ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'

import { object, string } from './stdio-rpc'

export function createAcpTranslator(
  turnId: string,
  options: {
    toolName: (update: Record<string, unknown>) => string
    toolInput: (update: Record<string, unknown>) => unknown
    toolOutput: (output: unknown) => string
    hideTool?: (update: Record<string, unknown>) => boolean
  }
) {
  const tools = new Map<string, { id: string; done: boolean }>()
  const reserved = new Map<string, string>()
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
    if (update.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
      // Grok's todo list, as Claude's TodoWrite input, like Codex's plan.
      const todos = update.entries.map(object).map((entry) => ({
        content: string(entry.content),
        status: string(entry.status),
      }))
      const id = newId()
      events.push(
        ...closeText(),
        {
          type: 'item.started',
          item: {
            ...base,
            id,
            kind: 'tool_call',
            toolName: 'update_plan',
            input: { todos },
            output: '',
            status: 'running',
          },
        },
        { type: 'item.completed', itemId: id, patch: { status: 'succeeded' } }
      )
      return events
    }
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
      if (options.hideTool?.(update)) return events
      events.push(...closeText())
      let tool = tools.get(key)
      if (tool?.done) return events
      if (!tool) {
        tool = { id: reserved.get(key) ?? newId(), done: false }
        tools.set(key, tool)
        events.push({
          type: 'item.started',
          item: {
            ...base,
            id: tool.id,
            kind: 'tool_call',
            toolName: options.toolName(update),
            input: options.toolInput(update) ?? {},
            output: '',
            status: 'running',
          },
        })
      }
      const done = update.status === 'completed' || update.status === 'failed'
      tool.done = done
      events.push({
        type: done ? 'item.completed' : 'item.updated',
        itemId: tool.id,
        patch: {
          ...(update.kind === undefined && update.rawInput === undefined
            ? {}
            : { toolName: options.toolName(update) }),
          ...(update.rawInput === undefined ? {} : { input: options.toolInput(update) }),
          ...(update.rawOutput === undefined && update.content === undefined
            ? {}
            : {
                output: options.toolOutput(update.rawOutput ?? update.content),
              }),
          status: done ? (update.status === 'failed' ? 'failed' : 'succeeded') : 'running',
        },
      })
    }
    return events
  }

  // A tool cut off by Stop didn't fail: left unsettled, it reads as stopped, as Claude's do.
  function finish(stopped = false): ThreadEvent[] {
    const events = closeText()
    for (const tool of tools.values()) {
      if (tool.done) continue
      tool.done = true
      events.push(
        stopped
          ? { type: 'item.completed', itemId: tool.id }
          : { type: 'item.completed', itemId: tool.id, patch: { status: 'failed' } }
      )
    }
    return events
  }
  function toolItemId(toolCallId: string) {
    const known = tools.get(toolCallId)?.id ?? reserved.get(toolCallId)
    if (known) return known
    const id = newId()
    reserved.set(toolCallId, id)
    return id
  }
  return { translate, finish, toolItemId, tools, closeText }
}

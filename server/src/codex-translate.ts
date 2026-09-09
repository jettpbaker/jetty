import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import { newId } from '@jetty/shared/wire'

import { object, string, type RpcMessage } from './codex-rpc'

export function createCodexTranslator(turnId: string) {
  const items = new Map<string, ThreadItem>()
  const completed = new Set<string>()

  function itemFrom(raw: Record<string, unknown>): ThreadItem | undefined {
    const base = { id: newId(), turnId, createdAt: Date.now() }
    switch (raw.type) {
      case 'agentMessage':
        return { ...base, kind: 'assistant_message', text: string(raw.text), streaming: true }
      case 'reasoning':
        return { ...base, kind: 'reasoning', text: textArray(raw.summary), streaming: true }
      case 'plan':
        return { ...base, kind: 'plan', text: string(raw.text), streaming: true }
      case 'userMessage':
      case 'hookPrompt':
        return undefined
      default:
        return {
          ...base,
          kind: 'tool_call',
          toolName: string(raw.tool) || string(raw.type),
          input: raw.arguments ?? raw.command ?? raw.changes ?? raw,
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
        events.push({ type: 'item.started', item })
      }
      if (method === 'item/completed') {
        completed.add(id)
        const patch =
          item.kind === 'tool_call'
            ? {
                status:
                  raw.status === 'failed' ||
                  raw.status === 'declined' ||
                  raw.success === false ||
                  (typeof raw.exitCode === 'number' && raw.exitCode !== 0)
                    ? 'failed'
                    : 'succeeded',
                output:
                  typeof raw.aggregatedOutput === 'string'
                    ? raw.aggregatedOutput
                    : JSON.stringify(
                        raw.result ?? raw.error ?? raw.changes ?? raw.contentItems ?? raw
                      ),
              }
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
    } else if (
      method === 'item/agentMessage/delta' ||
      method === 'item/reasoning/summaryTextDelta' ||
      method === 'item/plan/delta' ||
      method === 'item/commandExecution/outputDelta'
    ) {
      const item = items.get(string(params.itemId))
      if (item && typeof params.delta === 'string') {
        events.push({ type: 'item.delta', itemId: item.id, delta: params.delta })
      }
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

  function finish(): ThreadEvent[] {
    const events: ThreadEvent[] = []
    for (const [id, item] of items) {
      if (completed.has(id)) continue
      completed.add(id)
      events.push({
        type: 'item.completed',
        itemId: item.id,
        patch: item.kind === 'tool_call' ? { status: 'failed' } : { streaming: false },
      })
    }
    return events
  }

  return { translate, finish }
}

function textArray(value: unknown): string {
  return Array.isArray(value) ? value.filter((part) => typeof part === 'string').join('\n\n') : ''
}

function natural(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

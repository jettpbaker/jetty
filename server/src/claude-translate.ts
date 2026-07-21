import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import { newId } from '@jetty/shared/wire'

export type TranslateCtx = {
  turnId: string
  currentAssistantId: string | null
  currentReasoningId: string | null
  /** tool_use id → tool_call item id */
  toolUseToItemId: Map<string, string>
  /** item ids built from stream_event partials — skip duplicate final assistant content */
  partialItemIds: Set<string>
  /** stream content_block index → block kind */
  blockKinds: Map<number, 'text' | 'thinking' | 'tool_use'>
  /** stream content_block index → tool_use accumulation */
  toolBlocks: Map<number, { id: string; name: string; json: string }>
  /** true once any stream_event content was applied this assistant message */
  sawPartials: boolean
  sessionId: string | null
}

export function createTranslateCtx(turnId: string): TranslateCtx {
  return {
    turnId,
    currentAssistantId: null,
    currentReasoningId: null,
    toolUseToItemId: new Map(),
    partialItemIds: new Set(),
    blockKinds: new Map(),
    toolBlocks: new Map(),
    sawPartials: false,
    sessionId: null,
  }
}

/** SDK message shapes we care about — structural so fixtures need no SDK imports. */
export type SdkLikeMessage = {
  type: string
  subtype?: string
  session_id?: string
  event?: StreamEvent
  message?: {
    content?: unknown
  }
  parent_tool_use_id?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
  total_cost_usd?: number
  errors?: string[]
  is_error?: boolean
  result?: string
}

type StreamEvent = {
  type: string
  index?: number
  content_block?: {
    type: string
    text?: string
    thinking?: string
    id?: string
    name?: string
    input?: unknown
  }
  delta?: {
    type: string
    text?: string
    thinking?: string
    estimated_tokens?: number
    partial_json?: string
  }
}

function thinkingTokens(delta: { estimated_tokens?: number }): { tokens?: number } {
  return typeof delta.estimated_tokens === 'number' ? { tokens: delta.estimated_tokens } : {}
}

export function translate(msg: SdkLikeMessage, ctx: TranslateCtx): ThreadEvent[] {
  // Messages from inside a subagent carry parent_tool_use_id. We don't render
  // subagent internals yet — dropping them keeps the Agent tool_use + its
  // result (the SDK's default verbosity) and stops inner messages from
  // corrupting the main timeline's streaming ctx.
  if (msg.parent_tool_use_id != null) return []

  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init' && typeof msg.session_id === 'string') {
        ctx.sessionId = msg.session_id
      }
      return []

    case 'stream_event':
      return translateStreamEvent(msg.event, ctx)

    case 'assistant':
      return translateAssistant(msg, ctx)

    case 'user':
      return translateUser(msg, ctx)

    case 'result':
      return translateResult(msg, ctx)

    default:
      return []
  }
}

function translateStreamEvent(event: StreamEvent | undefined, ctx: TranslateCtx): ThreadEvent[] {
  if (!event) return []
  const out: ThreadEvent[] = []

  switch (event.type) {
    case 'content_block_start': {
      const index = event.index ?? 0
      const block = event.content_block
      if (!block) return []

      if (block.type === 'text') {
        ctx.blockKinds.set(index, 'text')
        if (!ctx.currentAssistantId) {
          const id = newId()
          ctx.currentAssistantId = id
          ctx.partialItemIds.add(id)
          out.push({
            type: 'item.started',
            item: {
              id,
              turnId: ctx.turnId,
              createdAt: Date.now(),
              kind: 'assistant_message',
              text: block.text ?? '',
              streaming: true,
            },
          })
          ctx.sawPartials = true
        } else if (block.text) {
          out.push({ type: 'item.delta', itemId: ctx.currentAssistantId, delta: block.text })
          ctx.sawPartials = true
        }
      } else if (block.type === 'thinking') {
        ctx.blockKinds.set(index, 'thinking')
        if (!ctx.currentReasoningId) {
          const id = newId()
          ctx.currentReasoningId = id
          ctx.partialItemIds.add(id)
          out.push({
            type: 'item.started',
            item: {
              id,
              turnId: ctx.turnId,
              createdAt: Date.now(),
              kind: 'reasoning',
              text: block.thinking ?? '',
              streaming: true,
            },
          })
          ctx.sawPartials = true
        } else if (block.thinking) {
          out.push({ type: 'item.delta', itemId: ctx.currentReasoningId, delta: block.thinking })
          ctx.sawPartials = true
        }
      } else if (block.type === 'tool_use') {
        ctx.blockKinds.set(index, 'tool_use')
        const toolUseId = block.id ?? ''
        // Input streams via input_json_delta; start empty even when the block
        // carries `{}` so partials don't concatenate onto a pre-stringified object.
        ctx.toolBlocks.set(index, {
          id: toolUseId,
          name: block.name ?? 'tool',
          json: '',
        })
        ctx.sawPartials = true
      }
      return out
    }

    case 'content_block_delta': {
      const index = event.index ?? 0
      const delta = event.delta
      if (!delta) return []
      const kind = ctx.blockKinds.get(index)

      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        const itemId = ensureStreamItem(ctx, out, 'assistant_message')
        out.push({ type: 'item.delta', itemId, delta: delta.text })
        ctx.sawPartials = true
      } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        const itemId = ensureStreamItem(ctx, out, 'reasoning')
        out.push({ type: 'item.delta', itemId, delta: delta.thinking, ...thinkingTokens(delta) })
        ctx.sawPartials = true
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const tool = ctx.toolBlocks.get(index)
        if (tool) tool.json += delta.partial_json
      } else if (kind === 'text' && typeof delta.text === 'string') {
        const itemId = ensureStreamItem(ctx, out, 'assistant_message')
        out.push({ type: 'item.delta', itemId, delta: delta.text })
        ctx.sawPartials = true
      } else if (kind === 'thinking' && typeof delta.thinking === 'string') {
        const itemId = ensureStreamItem(ctx, out, 'reasoning')
        out.push({ type: 'item.delta', itemId, delta: delta.thinking, ...thinkingTokens(delta) })
        ctx.sawPartials = true
      }
      return out
    }

    case 'content_block_stop': {
      const index = event.index ?? 0
      const kind = ctx.blockKinds.get(index)

      if (kind === 'text' && ctx.currentAssistantId) {
        out.push({ type: 'item.completed', itemId: ctx.currentAssistantId })
        ctx.currentAssistantId = null
      } else if (kind === 'thinking' && ctx.currentReasoningId) {
        out.push({ type: 'item.completed', itemId: ctx.currentReasoningId })
        ctx.currentReasoningId = null
      } else if (kind === 'tool_use') {
        const tool = ctx.toolBlocks.get(index)
        if (tool) {
          let input: unknown = {}
          if (tool.json) {
            try {
              input = JSON.parse(tool.json)
            } catch {
              input = tool.json
            }
          }
          const itemId = newId()
          if (tool.id) ctx.toolUseToItemId.set(tool.id, itemId)
          ctx.partialItemIds.add(itemId)
          const item: ThreadItem = {
            id: itemId,
            turnId: ctx.turnId,
            createdAt: Date.now(),
            kind: 'tool_call',
            toolName: tool.name,
            input,
            output: '',
            status: 'running',
          }
          out.push({ type: 'item.started', item })
          ctx.toolBlocks.delete(index)
        }
      }

      ctx.blockKinds.delete(index)
      return out
    }

    case 'message_stop':
      // close any open text/thinking items that missed content_block_stop
      if (ctx.currentAssistantId) {
        out.push({ type: 'item.completed', itemId: ctx.currentAssistantId })
        ctx.currentAssistantId = null
      }
      if (ctx.currentReasoningId) {
        out.push({ type: 'item.completed', itemId: ctx.currentReasoningId })
        ctx.currentReasoningId = null
      }
      return out

    default:
      return []
  }
}

function ensureStreamItem(
  ctx: TranslateCtx,
  out: ThreadEvent[],
  kind: 'assistant_message' | 'reasoning'
): string {
  const field = kind === 'assistant_message' ? 'currentAssistantId' : 'currentReasoningId'
  const existing = ctx[field]
  if (existing) return existing
  const id = newId()
  ctx[field] = id
  ctx.partialItemIds.add(id)
  out.push({
    type: 'item.started',
    item: {
      id,
      turnId: ctx.turnId,
      createdAt: Date.now(),
      kind,
      text: '',
      streaming: true,
    },
  })
  return id
}

function translateAssistant(msg: SdkLikeMessage, ctx: TranslateCtx): ThreadEvent[] {
  // Final complete assistant message — skip content already streamed via partials.
  if (ctx.sawPartials) {
    if (ctx.currentAssistantId) {
      const events: ThreadEvent[] = [{ type: 'item.completed', itemId: ctx.currentAssistantId }]
      ctx.currentAssistantId = null
      return events
    }
    if (ctx.currentReasoningId) {
      const events: ThreadEvent[] = [{ type: 'item.completed', itemId: ctx.currentReasoningId }]
      ctx.currentReasoningId = null
      return events
    }
    return []
  }

  const content = msg.message?.content
  if (!Array.isArray(content)) return []

  const out: ThreadEvent[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as {
      type?: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      input?: unknown
    }

    if (b.type === 'text' && typeof b.text === 'string') {
      const id = newId()
      out.push({
        type: 'item.started',
        item: {
          id,
          turnId: ctx.turnId,
          createdAt: Date.now(),
          kind: 'assistant_message',
          text: b.text,
          streaming: true,
        },
      })
      out.push({ type: 'item.completed', itemId: id })
    } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
      const id = newId()
      out.push({
        type: 'item.started',
        item: {
          id,
          turnId: ctx.turnId,
          createdAt: Date.now(),
          kind: 'reasoning',
          text: b.thinking,
          streaming: true,
        },
      })
      out.push({ type: 'item.completed', itemId: id })
    } else if (b.type === 'tool_use') {
      const itemId = newId()
      if (b.id) ctx.toolUseToItemId.set(b.id, itemId)
      out.push({
        type: 'item.started',
        item: {
          id: itemId,
          turnId: ctx.turnId,
          createdAt: Date.now(),
          kind: 'tool_call',
          toolName: b.name ?? 'tool',
          input: b.input ?? {},
          output: '',
          status: 'running',
        },
      })
    }
  }
  return out
}

function translateUser(msg: SdkLikeMessage, ctx: TranslateCtx): ThreadEvent[] {
  const content = msg.message?.content
  if (!Array.isArray(content)) return []

  const out: ThreadEvent[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as {
      type?: string
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
    }
    if (b.type !== 'tool_result' || !b.tool_use_id) continue

    const itemId = ctx.toolUseToItemId.get(b.tool_use_id)
    if (!itemId) continue

    const output = toolResultToString(b.content)
    if (output) {
      out.push({ type: 'item.delta', itemId, delta: output })
    }
    out.push({
      type: 'item.completed',
      itemId,
      patch: { status: b.is_error ? 'failed' : 'succeeded' },
    })
  }
  return out
}

function toolResultToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part)
      } else if (part && typeof part === 'object' && 'text' in part) {
        parts.push(String((part as { text: unknown }).text))
      } else if (part !== undefined) {
        parts.push(JSON.stringify(part))
      }
    }
    return parts.join('')
  }
  if (content === undefined || content === null) return ''
  return JSON.stringify(content)
}

function translateResult(msg: SdkLikeMessage, ctx: TranslateCtx): ThreadEvent[] {
  const out: ThreadEvent[] = []

  // Close any still-open items.
  if (ctx.currentAssistantId) {
    out.push({ type: 'item.completed', itemId: ctx.currentAssistantId })
    ctx.currentAssistantId = null
  }
  if (ctx.currentReasoningId) {
    out.push({ type: 'item.completed', itemId: ctx.currentReasoningId })
    ctx.currentReasoningId = null
  }

  if (msg.subtype === 'success') {
    out.push({
      type: 'turn.completed',
      turnId: ctx.turnId,
      usage: {
        inputTokens: msg.usage?.input_tokens ?? 0,
        outputTokens: msg.usage?.output_tokens ?? 0,
      },
      costUsd: msg.total_cost_usd,
    })
  } else {
    const error =
      Array.isArray(msg.errors) && msg.errors.length > 0
        ? msg.errors.join('; ')
        : msg.subtype
          ? String(msg.subtype)
          : 'turn failed'
    out.push({ type: 'turn.failed', turnId: ctx.turnId, error })
  }

  ctx.sawPartials = false
  ctx.blockKinds.clear()
  ctx.toolBlocks.clear()
  return out
}

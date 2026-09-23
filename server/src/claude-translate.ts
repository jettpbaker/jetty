import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import { newId } from '@jetty/shared/wire'

import { SEND_IMAGES_TOOL } from './send-images'
import { SEND_VIDEO_TOOL } from './send-video'

const HIDDEN_TOOLS: ReadonlySet<string> = new Set([SEND_IMAGES_TOOL, SEND_VIDEO_TOOL])
// `Task` is the Agent tool's name in older Claude Code releases.
const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])

export type TranslateCtx = {
  turnId: string
  agentId: string | null
  // shared by the main ctx and every subagent ctx: subagent streams stay separate
  agents: Map<string, TranslateCtx>
  // the SDK's task id (canUseTool's agentID) → the subagent item id
  tasks: Map<string, string>
  currentAssistantId: string | null
  currentReasoningId: string | null
  toolUseToItemId: Map<string, string>
  blockKinds: Map<number, 'text' | 'thinking' | 'tool_use'>
  toolBlocks: Map<number, { id: string; name: string; json: string }>
  sawPartials: boolean
  sawModel: boolean
  sessionId: string | null
}

export function createTranslateCtx(
  turnId: string,
  shared?: TranslateCtx,
  agentId: string | null = null
): TranslateCtx {
  return {
    turnId,
    agentId,
    agents: shared?.agents ?? new Map(),
    tasks: shared?.tasks ?? new Map(),
    currentAssistantId: null,
    currentReasoningId: null,
    toolUseToItemId: new Map(),
    blockKinds: new Map(),
    toolBlocks: new Map(),
    sawPartials: false,
    sawModel: false,
    sessionId: null,
  }
}

export type SdkLikeMessage = {
  type: string
  subtype?: string
  session_id?: string
  event?: StreamEvent
  message?: {
    content?: unknown
    model?: string
  }
  parent_tool_use_id?: string | null
  tool_use_id?: string
  task_id?: string
  subagent_type?: string
  status?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    duration_ms?: number
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

export function translate(msg: SdkLikeMessage, ctx: TranslateCtx): ThreadEvent[] {
  const parent = msg.parent_tool_use_id
  if (parent != null && msg.type !== 'system' && msg.type !== 'result')
    return translate({ ...msg, parent_tool_use_id: null }, agentCtx(ctx, parent))

  switch (msg.type) {
    case 'system':
      return translateSystem(msg, ctx)

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

function agentCtx(ctx: TranslateCtx, agentId: string): TranslateCtx {
  let agent = ctx.agents.get(agentId)
  if (!agent) {
    agent = createTranslateCtx(ctx.turnId, ctx, agentId)
    ctx.agents.set(agentId, agent)
  }
  return agent
}

function itemBase(ctx: TranslateCtx) {
  return {
    turnId: ctx.turnId,
    createdAt: Date.now(),
    ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
  }
}

const SETTLED_TASK_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'stopped'])

function natural(value: number | undefined) {
  return value != null && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

export function subagentOf(ctx: TranslateCtx, taskId: string | undefined) {
  return taskId ? ctx.tasks.get(taskId) : undefined
}

function translateSystem(msg: SdkLikeMessage, ctx: TranslateCtx): ThreadEvent[] {
  if (msg.subtype === 'init' && typeof msg.session_id === 'string') {
    ctx.sessionId = msg.session_id
    return []
  }
  const itemId = msg.tool_use_id
  if (!itemId || !ctx.agents.has(itemId)) return []
  const tokens = natural(msg.usage?.total_tokens)
  if (msg.subtype === 'task_started') {
    if (msg.task_id) ctx.tasks.set(msg.task_id, itemId)
    return msg.subagent_type
      ? [{ type: 'item.updated', itemId, patch: { agentType: msg.subagent_type } }]
      : []
  }
  if (msg.subtype === 'task_progress' && tokens != null)
    return [{ type: 'item.updated', itemId, patch: { tokens } }]
  if (msg.subtype === 'task_notification' && msg.status && SETTLED_TASK_STATUSES.has(msg.status)) {
    const durationMs = natural(msg.usage?.duration_ms)
    return [
      {
        type: 'item.completed',
        itemId,
        patch: {
          status: msg.status,
          ...(tokens != null ? { tokens } : {}),
          ...(durationMs != null ? { durationMs } : {}),
        },
      },
    ]
  }
  return []
}

function toolItem(ctx: TranslateCtx, toolUseId: string, name: string, input: unknown): ThreadItem {
  if (AGENT_TOOLS.has(name) && toolUseId) {
    agentCtx(ctx, toolUseId)
    const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const text = (key: string) => (typeof fields[key] === 'string' ? fields[key] : undefined)
    return {
      id: toolUseId,
      ...itemBase(ctx),
      kind: 'subagent',
      title: text('description') ?? 'Subagent',
      prompt: text('prompt') ?? '',
      ...(text('subagent_type') ? { agentType: text('subagent_type') } : {}),
      ...(text('model') ? { model: text('model') } : {}),
      status: 'running',
    }
  }
  const itemId = newId()
  if (toolUseId) ctx.toolUseToItemId.set(toolUseId, itemId)
  return {
    id: itemId,
    ...itemBase(ctx),
    kind: 'tool_call',
    toolName: name,
    input,
    output: '',
    status: 'running',
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

      if (block.type === 'text' || block.type === 'thinking') {
        ctx.blockKinds.set(index, block.type)
        const kind = block.type === 'text' ? 'assistant_message' : 'reasoning'
        const text = (block.type === 'text' ? block.text : block.thinking) ?? ''
        const openId = ctx[OPEN_FIELD[kind]]
        if (!openId) startStreamItem(ctx, out, kind, text)
        else if (text) out.push({ type: 'item.delta', itemId: openId, delta: text })
        ctx.sawPartials = true
      } else if (block.type === 'tool_use') {
        ctx.blockKinds.set(index, 'tool_use')
        // block.input is a `{}` placeholder; the real input arrives via input_json_delta.
        ctx.toolBlocks.set(index, { id: block.id ?? '', name: block.name ?? 'tool', json: '' })
        ctx.sawPartials = true
      }
      return out
    }

    case 'content_block_delta': {
      const index = event.index ?? 0
      const delta = event.delta
      if (!delta) return []
      const kind = ctx.blockKinds.get(index)

      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const tool = ctx.toolBlocks.get(index)
        if (tool) tool.json += delta.partial_json
      } else if (
        typeof delta.text === 'string' &&
        (delta.type === 'text_delta' || kind === 'text')
      ) {
        streamDelta(ctx, out, 'assistant_message', delta.text)
      } else if (
        typeof delta.thinking === 'string' &&
        (delta.type === 'thinking_delta' || kind === 'thinking')
      ) {
        streamDelta(ctx, out, 'reasoning', delta.thinking, delta.estimated_tokens)
      }
      return out
    }

    case 'content_block_stop': {
      const index = event.index ?? 0
      const kind = ctx.blockKinds.get(index)

      if (kind === 'text') {
        out.push(...closeStreamItem(ctx, 'assistant_message'))
      } else if (kind === 'thinking') {
        out.push(...closeStreamItem(ctx, 'reasoning'))
      } else if (kind === 'tool_use') {
        const tool = ctx.toolBlocks.get(index)
        if (tool) {
          ctx.toolBlocks.delete(index)
          if (!HIDDEN_TOOLS.has(tool.name)) {
            let input: unknown = {}
            if (tool.json) {
              try {
                input = JSON.parse(tool.json)
              } catch {
                input = tool.json
              }
            }
            out.push({ type: 'item.started', item: toolItem(ctx, tool.id, tool.name, input) })
          }
        }
      }

      ctx.blockKinds.delete(index)
      return out
    }

    case 'message_stop':
      return closeStreamItems(ctx)

    default:
      return []
  }
}

type StreamKind = 'assistant_message' | 'reasoning'

const OPEN_FIELD = {
  assistant_message: 'currentAssistantId',
  reasoning: 'currentReasoningId',
} as const

function startStreamItem(
  ctx: TranslateCtx,
  out: ThreadEvent[],
  kind: StreamKind,
  text: string
): string {
  const id = newId()
  ctx[OPEN_FIELD[kind]] = id
  out.push({
    type: 'item.started',
    item: { id, ...itemBase(ctx), kind, text, streaming: true },
  })
  return id
}

function streamDelta(
  ctx: TranslateCtx,
  out: ThreadEvent[],
  kind: StreamKind,
  delta: string,
  tokens?: number
) {
  const itemId = ctx[OPEN_FIELD[kind]] ?? startStreamItem(ctx, out, kind, '')
  out.push({
    type: 'item.delta',
    itemId,
    delta,
    ...(typeof tokens === 'number' ? { tokens } : {}),
  })
  ctx.sawPartials = true
}

function closeStreamItem(ctx: TranslateCtx, kind: StreamKind): ThreadEvent[] {
  const itemId = ctx[OPEN_FIELD[kind]]
  if (!itemId) return []
  ctx[OPEN_FIELD[kind]] = null
  return [{ type: 'item.completed', itemId }]
}

function closeStreamItems(ctx: TranslateCtx): ThreadEvent[] {
  return [...closeStreamItem(ctx, 'assistant_message'), ...closeStreamItem(ctx, 'reasoning')]
}

function translateAssistant(msg: SdkLikeMessage, ctx: TranslateCtx): ThreadEvent[] {
  const model = msg.message?.model
  const modelPatch: ThreadEvent[] =
    ctx.agentId && model && !ctx.sawModel
      ? [{ type: 'item.updated', itemId: ctx.agentId, patch: { model } }]
      : []
  if (model) ctx.sawModel = true
  return [...modelPatch, ...translateAssistantContent(msg, ctx)]
}

function translateAssistantContent(msg: SdkLikeMessage, ctx: TranslateCtx): ThreadEvent[] {
  if (ctx.sawPartials)
    return closeStreamItem(ctx, ctx.currentAssistantId ? 'assistant_message' : 'reasoning')

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

    const text = b.type === 'text' ? b.text : b.type === 'thinking' ? b.thinking : undefined
    if (typeof text === 'string') {
      const id = newId()
      out.push(
        {
          type: 'item.started',
          item: {
            id,
            ...itemBase(ctx),
            kind: b.type === 'text' ? 'assistant_message' : 'reasoning',
            text,
            streaming: true,
          },
        },
        { type: 'item.completed', itemId: id }
      )
    } else if (b.type === 'tool_use' && !HIDDEN_TOOLS.has(b.name ?? 'tool')) {
      out.push({
        type: 'item.started',
        item: toolItem(ctx, b.id ?? '', b.name ?? 'tool', b.input ?? {}),
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
    // A subagent settles via its task_notification: a backgrounded one's tool_result is only a placeholder.
    if (ctx.agents.has(b.tool_use_id)) {
      if (b.is_error)
        out.push({ type: 'item.completed', itemId: b.tool_use_id, patch: { status: 'failed' } })
      continue
    }

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
  const out = closeStreamItems(ctx)
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
    const error = msg.errors?.length ? msg.errors.join('; ') : msg.subtype || 'turn failed'
    out.push({ type: 'turn.failed', turnId: ctx.turnId, error })
  }

  ctx.sawPartials = false
  ctx.blockKinds.clear()
  ctx.toolBlocks.clear()
  return out
}

import type { ContextUsage, ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'
import type { EffortLevel, PermissionMode, UploadAttachment, Usage } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'

/** Image payload for the agent seam — no SDK types. */
export type AgentImage = {
  mimeType: UploadAttachment['mimeType']
  base64data: string
}

export type TurnInput = {
  threadId: string
  turnId: string
  text: string
  images?: AgentImage[]
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
}

/** Optional hooks wired at agent construction — agents stay socket-free. */
export type AgentHooks = {
  onUsage?: (usage: Usage) => void
}

export type Agent = {
  startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void>
  /** Optional reason becomes the turn.failed error (default 'interrupted'). */
  interrupt(threadId: string, reason?: string): void
  steer(threadId: string, text: string, images?: AgentImage[]): boolean
  respondToApproval(
    threadId: string,
    itemId: string,
    decision: ApprovalDecision,
    message?: string,
    updatedPermissions?: unknown[]
  ): boolean
  respondToQuestion(threadId: string, itemId: string, answers: Record<string, string>): boolean
}

const CHUNK_MS = 8
const STEP_MS = 5

const ECHO_MAX_TOKENS = 200_000
const ECHO_COMPACT_AT = 180_000
const ECHO_FIXED_SLICES = [
  { label: 'System prompt', tokens: 3_248 },
  { label: 'System tools', tokens: 11_760 },
  { label: 'Memory files', tokens: 2_412 },
  { label: 'MCP tools', tokens: 6_090 },
] as const
const ECHO_FIXED_SUM = ECHO_FIXED_SLICES.reduce((sum, s) => sum + s.tokens, 0)

type EchoSession = {
  ac: AbortController
  emit: (event: ThreadEvent) => void
  assistantId: string | null
  pendingSteer: string[]
}

export function createEchoAdapter(hooks: AgentHooks = {}): Agent {
  const sessions = new Map<string, EchoSession>()
  const contextByThread = new Map<string, number>()

  async function emitChunks(
    emit: (event: ThreadEvent) => void,
    itemId: string,
    text: string,
    signal: AbortSignal
  ) {
    const size = Math.max(1, Math.ceil(text.length / 4))
    for (let i = 0; i < text.length; i += size) {
      await sleep(CHUNK_MS, signal)
      emit({ type: 'item.delta', itemId, delta: text.slice(i, i + size) })
    }
    await sleep(STEP_MS, signal)
  }

  function echoContextUsage(usedTokens: number): ContextUsage {
    const used = Math.min(Math.max(0, Math.round(usedTokens)), ECHO_MAX_TOKENS)
    const messages = Math.max(0, used - ECHO_FIXED_SUM)
    return {
      usedTokens: used,
      maxTokens: ECHO_MAX_TOKENS,
      compactAt: ECHO_COMPACT_AT,
      slices: [
        ...ECHO_FIXED_SLICES.map((s) => ({ label: s.label, tokens: s.tokens })),
        { label: 'Messages', tokens: messages },
      ],
      model: 'echo-sonnet',
      asOf: Date.now(),
    }
  }

  function nextContextTarget(threadId: string): { from: number; to: number } {
    const prev = contextByThread.get(threadId)
    if (prev == null) {
      const to = Math.round((echoSeedPct() / 100) * ECHO_MAX_TOKENS)
      contextByThread.set(threadId, to)
      const from = Math.min(to, Math.max(ECHO_FIXED_SUM, Math.round(to * 0.55)))
      return { from, to }
    }
    // 6–9% of the window; step keyed off current fill so it's deterministic per thread
    const step = Math.floor(prev / 10_000) % 4
    const growth = Math.round(ECHO_MAX_TOKENS * (0.06 + step * 0.01))
    const to = Math.min(ECHO_MAX_TOKENS, prev + growth)
    contextByThread.set(threadId, to)
    return { from: prev, to }
  }

  return {
    interrupt(threadId: string) {
      sessions.get(threadId)?.ac.abort()
    },

    steer(threadId: string, text: string, _images?: AgentImage[]): boolean {
      const session = sessions.get(threadId)
      if (!session) return false
      if (session.assistantId) {
        session.emit({ type: 'item.delta', itemId: session.assistantId, delta: text })
      } else {
        session.pendingSteer.push(text)
      }
      return true
    },

    respondToApproval(): boolean {
      return false
    },

    respondToQuestion(): boolean {
      return false
    },

    async startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void> {
      sessions.get(input.threadId)?.ac.abort()
      const ac = new AbortController()
      const session: EchoSession = {
        ac,
        emit,
        assistantId: null,
        pendingSteer: [],
      }
      sessions.set(input.threadId, session)
      const { signal } = ac
      const { from, to } = nextContextTarget(input.threadId)
      const ramp = [
        Math.round(from + (to - from) * 0.25),
        Math.round(from + (to - from) * 0.5),
        Math.round(from + (to - from) * 0.75),
        to,
      ]

      try {
        emit({ type: 'turn.started', turnId: input.turnId })

        const reasoning: ThreadItem = {
          id: newId(),
          turnId: input.turnId,
          createdAt: Date.now(),
          kind: 'reasoning',
          text: '',
        }
        emit({ type: 'item.started', item: reasoning })
        await emitChunks(emit, reasoning.id, 'Thinking about your message…', signal)
        emit({ type: 'item.completed', itemId: reasoning.id })
        emit({ type: 'context.updated', usage: echoContextUsage(ramp[0]!) })

        const tool: ThreadItem = {
          id: newId(),
          turnId: input.turnId,
          createdAt: Date.now(),
          kind: 'tool_call',
          toolName: 'echo',
          input: { text: input.text },
          output: '',
          status: 'running',
        }
        emit({ type: 'item.started', item: tool })
        await emitChunks(emit, tool.id, `echo: ${input.text}`, signal)
        emit({ type: 'item.completed', itemId: tool.id, patch: { status: 'succeeded' } })
        emit({ type: 'context.updated', usage: echoContextUsage(ramp[1]!) })

        const assistant: ThreadItem = {
          id: newId(),
          turnId: input.turnId,
          createdAt: Date.now(),
          kind: 'assistant_message',
          text: '',
        }
        session.assistantId = assistant.id
        emit({ type: 'item.started', item: assistant })
        await emitChunks(emit, assistant.id, input.text, signal)
        emit({ type: 'context.updated', usage: echoContextUsage(ramp[2]!) })
        for (const steered of session.pendingSteer) {
          await emitChunks(emit, assistant.id, steered, signal)
        }
        session.pendingSteer = []
        emit({ type: 'item.completed', itemId: assistant.id })

        emit({ type: 'context.updated', usage: echoContextUsage(ramp[3]!) })
        emit({
          type: 'turn.completed',
          turnId: input.turnId,
          usage: { inputTokens: input.text.length, outputTokens: input.text.length },
          costUsd: 0,
        })

        // Plausible fixed numbers so home UI is developable without the real agent.
        hooks.onUsage?.({
          fiveHour: { pct: 42, resetsAt: Date.now() + 2 * 60 * 60 * 1000 },
          sevenDay: { pct: 18, resetsAt: Date.now() + 3 * 24 * 60 * 60 * 1000 },
          asOf: Date.now(),
        })
      } catch (err) {
        if (!isAbortError(err)) throw err
        emit({ type: 'turn.failed', turnId: input.turnId, error: 'interrupted' })
      } finally {
        if (sessions.get(input.threadId) === session) {
          sessions.delete(input.threadId)
        }
      }
    },
  }
}

function echoSeedPct(): number {
  const raw = Number(process.env.JETTY_ECHO_CONTEXT_PCT)
  if (Number.isFinite(raw) && raw >= 0 && raw <= 100) return raw
  return 12
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

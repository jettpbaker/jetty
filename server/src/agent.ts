import type { ContextUsage, ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'
import type {
  EffortLevel,
  PermissionMode,
  ProviderModel,
  UploadAttachment,
  RateLimits,
} from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Context, Deferred, Effect, Fiber, Layer, Queue, Semaphore } from 'effect'

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
  fast?: boolean
  permissionMode?: PermissionMode
}

export type AgentHooks = {
  onUsage?: (usage: RateLimits) => void
}

export class AgentError extends Error {
  readonly _tag = 'AgentError'
}

export type Emit = (
  event: ThreadEvent,
  onCommit?: Effect.Effect<void>
) => Effect.Effect<void, AgentError>
export type Turn = { await: Effect.Effect<void, AgentError> }

export type Agent = {
  startTurn(input: TurnInput, emit: Emit): Effect.Effect<Turn, AgentError>
  interrupt(threadId: string, reason?: string): Effect.Effect<void, AgentError>
  stopWorkflow?: (threadId: string, taskId: string) => Effect.Effect<boolean, AgentError>
  steer(
    threadId: string,
    text: string,
    images?: AgentImage[],
    beforeAccept?: Effect.Effect<void, AgentError>
  ): Effect.Effect<boolean, AgentError>
  respondToApproval(
    threadId: string,
    itemId: string,
    decision: ApprovalDecision,
    message?: string
  ): Effect.Effect<boolean, AgentError>
  // null answers dismiss the question
  respondToQuestion(
    threadId: string,
    itemId: string,
    answers: Record<string, string> | null
  ): Effect.Effect<boolean, AgentError>
}

export const AgentService = Context.Service<Agent>('jetty/Agent')

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

const ALL_EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const ECHO_MODELS: ProviderModel[] = [
  {
    provider: 'claude',
    id: 'opus',
    name: 'Opus',
    efforts: ALL_EFFORTS,
    fast: false,
    autoMode: true,
  },
  {
    provider: 'claude',
    id: 'sonnet',
    name: 'Sonnet',
    efforts: ALL_EFFORTS,
    fast: false,
    autoMode: true,
  },
  { provider: 'claude', id: 'haiku', name: 'Haiku', efforts: [], fast: false, autoMode: false },
  {
    provider: 'codex',
    id: 'gpt-echo',
    name: 'GPT-Echo',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
    fast: true,
    autoMode: true,
  },
  {
    provider: 'codex',
    id: 'gpt-echo-mini',
    name: 'GPT-Echo-Mini',
    efforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    fast: false,
    autoMode: true,
  },
  {
    provider: 'grok',
    id: 'grok-echo',
    name: 'Grok Echo',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'high',
    fast: true,
    autoMode: true,
  },
  {
    provider: 'grok',
    id: 'grok-echo-lite',
    name: 'Grok Echo Lite',
    efforts: ['low', 'medium', 'high'],
    defaultEffort: 'high',
    fast: false,
    autoMode: true,
  },
]

type EchoSession = {
  fiber: Fiber.Fiber<void, AgentError>
  input: Queue.Queue<string>
  reason: string
  accepting: boolean
  publication: Semaphore.Semaphore
}

export function createEchoAdapter(hooks: AgentHooks = {}) {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    const sessions = new Map<string, EchoSession>()
    const contextByThread = new Map<string, number>()

    function emitChunks(emit: Emit, itemId: string, text: string) {
      return Effect.gen(function* () {
        const size = Math.max(1, Math.ceil(text.length / 4))
        for (let i = 0; i < text.length; i += size) {
          yield* Effect.sleep(CHUNK_MS)
          yield* emit({ type: 'item.delta', itemId, delta: text.slice(i, i + size) })
        }
        yield* Effect.sleep(STEP_MS)
      })
    }

    function echoContextUsage(usedTokens: number): ContextUsage {
      const used = Math.min(Math.max(0, Math.round(usedTokens)), ECHO_MAX_TOKENS)
      const messages = Math.max(0, used - ECHO_FIXED_SUM)
      return {
        usedTokens: used,
        maxTokens: ECHO_MAX_TOKENS,
        compactAt: ECHO_COMPACT_AT,
        slices: [...ECHO_FIXED_SLICES, { label: 'Messages', tokens: messages }],
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
      const step = Math.floor(prev / 10_000) % 4
      const growth = Math.round(ECHO_MAX_TOKENS * (0.06 + step * 0.01))
      const to = Math.min(ECHO_MAX_TOKENS, prev + growth)
      contextByThread.set(threadId, to)
      return { from: prev, to }
    }

    return {
      interrupt(threadId, reason = 'interrupted') {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session) return
          yield* session.publication.withPermit(
            Effect.sync(() => {
              session.reason = reason
              session.accepting = false
            })
          )
          yield* Fiber.interrupt(session.fiber)
        })
      },
      steer(threadId, text, _images?: AgentImage[], beforeAccept = Effect.void) {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session || !session.accepting) return false
          return yield* session.publication.withPermit(
            Effect.gen(function* () {
              if (!session.accepting) return false
              yield* beforeAccept
              return yield* Queue.offer(session.input, text)
            }).pipe(Effect.uninterruptible)
          )
        })
      },
      respondToApproval() {
        return Effect.succeed(false)
      },
      respondToQuestion() {
        return Effect.succeed(false)
      },
      startTurn(input, publish) {
        return Effect.gen(function* () {
          if (sessions.has(input.threadId))
            return yield* Effect.fail(new AgentError('Turn already active'))
          const queue = yield* Queue.make<string>()
          const done = yield* Deferred.make<void, AgentError>()
          const session = {
            input: queue,
            reason: 'server shutdown',
            accepting: true,
            publication: yield* Semaphore.make(1),
          } as EchoSession
          const emit: Emit = (event, onCommit) =>
            session.publication.withPermit(publish(event, onCommit))
          const { from, to } = nextContextTarget(input.threadId)
          const ramp = [0.25, 0.5, 0.75, 1].map((f) => Math.round(from + (to - from) * f))
          const itemBase = () => ({ id: newId(), turnId: input.turnId, createdAt: Date.now() })

          const lifecycle = Effect.gen(function* () {
            yield* emit({ type: 'turn.started', turnId: input.turnId })

            const reasoning: ThreadItem = {
              ...itemBase(),
              kind: 'reasoning',
              text: '',
            }
            yield* emit({ type: 'item.started', item: reasoning })
            yield* emitChunks(emit, reasoning.id, 'Thinking about your message…')
            yield* emit({ type: 'item.completed', itemId: reasoning.id })
            yield* emit({ type: 'context.updated', usage: echoContextUsage(ramp[0]!) })

            const tool: ThreadItem = {
              ...itemBase(),
              kind: 'tool_call',
              toolName: 'echo',
              input: { text: input.text },
              output: '',
              status: 'running',
            }
            yield* emit({ type: 'item.started', item: tool })
            yield* emitChunks(emit, tool.id, `echo: ${input.text}`)
            yield* emit({ type: 'item.completed', itemId: tool.id, patch: { status: 'succeeded' } })
            yield* emit({ type: 'context.updated', usage: echoContextUsage(ramp[1]!) })

            const assistant: ThreadItem = {
              ...itemBase(),
              kind: 'assistant_message',
              text: '',
            }
            yield* emit({ type: 'item.started', item: assistant })
            yield* emitChunks(emit, assistant.id, input.text)
            yield* emit({ type: 'context.updated', usage: echoContextUsage(ramp[2]!) })
            while (true) {
              const steered = yield* session.publication.withPermit(
                Effect.gen(function* () {
                  if (queue.messages.length > 0) return yield* Queue.take(queue)
                  session.accepting = false
                  return null
                })
              )
              if (steered === null) break
              yield* emitChunks(emit, assistant.id, steered)
            }
            yield* emit({ type: 'item.completed', itemId: assistant.id })

            yield* emit({ type: 'context.updated', usage: echoContextUsage(ramp[3]!) })
            yield* emit({
              type: 'turn.completed',
              turnId: input.turnId,
              usage: { inputTokens: input.text.length, outputTokens: input.text.length },
              costUsd: 0,
            })

            hooks.onUsage?.({
              fiveHour: { pct: 42, resetsAt: Date.now() + 2 * 60 * 60 * 1000 },
              sevenDay: { pct: 18, resetsAt: Date.now() + 3 * 24 * 60 * 60 * 1000 },
              extraUsage: { used: 12.4, limit: 50, pct: 24.8, currency: 'USD' },
              asOf: Date.now(),
            })
          }).pipe(
            Effect.onInterrupt(() =>
              emit({ type: 'turn.failed', turnId: input.turnId, error: session.reason }).pipe(
                Effect.orDie
              )
            ),
            Effect.onExit((exit) => Deferred.done(done, exit)),
            Effect.ensuring(
              Effect.sync(() => {
                if (sessions.get(input.threadId) === session) sessions.delete(input.threadId)
              })
            ),
            Effect.ensuring(Queue.shutdown(queue))
          )
          sessions.set(input.threadId, session)
          session.fiber = yield* Effect.forkIn(lifecycle, scope, { startImmediately: true })
          return { await: Deferred.await(done) }
        })
      },
    } satisfies Agent
  })
}

export function echoLayer(hooks: AgentHooks = {}) {
  return Layer.effect(AgentService, createEchoAdapter(hooks))
}

function echoSeedPct(): number {
  const raw = Number(process.env.JETTY_ECHO_CONTEXT_PCT)
  if (Number.isFinite(raw) && raw >= 0 && raw <= 100) return raw
  return 12
}

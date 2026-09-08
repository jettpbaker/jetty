import type { ContextUsage, ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'
import type { EffortLevel, PermissionMode, UploadAttachment, Usage } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Context, Deferred, Effect, Fiber, Layer, Queue } from 'effect'

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

export class AgentError extends Error {
  readonly _tag = 'AgentError'
}

export type Emit = (event: ThreadEvent) => Effect.Effect<void, AgentError>
export type Turn = { await: Effect.Effect<void, AgentError> }

export type Agent = {
  startTurn(input: TurnInput, emit: Emit): Effect.Effect<Turn, AgentError>
  interrupt(threadId: string, reason?: string): Effect.Effect<void, AgentError>
  steer(threadId: string, text: string, images?: AgentImage[]): Effect.Effect<boolean, AgentError>
  respondToApproval(
    threadId: string,
    itemId: string,
    decision: ApprovalDecision,
    message?: string,
    updatedPermissions?: unknown[]
  ): Effect.Effect<boolean, AgentError>
  respondToQuestion(
    threadId: string,
    itemId: string,
    answers: Record<string, string>
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

type EchoSession = {
  fiber: Fiber.Fiber<void, AgentError>
  input: Queue.Queue<string>
  reason: string
  accepting: boolean
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
      interrupt(threadId, reason = 'interrupted') {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session) return
          session.reason = reason
          session.accepting = false
          yield* Fiber.interrupt(session.fiber)
        })
      },
      steer(threadId, text) {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session || !session.accepting) return false
          return yield* Queue.offer(session.input, text)
        })
      },
      respondToApproval() {
        return Effect.succeed(false)
      },
      respondToQuestion() {
        return Effect.succeed(false)
      },
      startTurn(input, emit) {
        return Effect.gen(function* () {
          if (sessions.has(input.threadId))
            return yield* Effect.fail(new AgentError('Turn already active'))
          const queue = yield* Queue.make<string>()
          const done = yield* Deferred.make<void, AgentError>()
          const session = {
            input: queue,
            reason: 'server shutdown',
            accepting: true,
          } as EchoSession
          const { from, to } = nextContextTarget(input.threadId)
          const ramp = [
            Math.round(from + (to - from) * 0.25),
            Math.round(from + (to - from) * 0.5),
            Math.round(from + (to - from) * 0.75),
            to,
          ]

          const lifecycle = Effect.gen(function* () {
            yield* emit({ type: 'turn.started', turnId: input.turnId })

            const reasoning: ThreadItem = {
              id: newId(),
              turnId: input.turnId,
              createdAt: Date.now(),
              kind: 'reasoning',
              text: '',
            }
            yield* emit({ type: 'item.started', item: reasoning })
            yield* emitChunks(emit, reasoning.id, 'Thinking about your message…')
            yield* emit({ type: 'item.completed', itemId: reasoning.id })
            yield* emit({ type: 'context.updated', usage: echoContextUsage(ramp[0]!) })

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
            yield* emit({ type: 'item.started', item: tool })
            yield* emitChunks(emit, tool.id, `echo: ${input.text}`)
            yield* emit({ type: 'item.completed', itemId: tool.id, patch: { status: 'succeeded' } })
            yield* emit({ type: 'context.updated', usage: echoContextUsage(ramp[1]!) })

            const assistant: ThreadItem = {
              id: newId(),
              turnId: input.turnId,
              createdAt: Date.now(),
              kind: 'assistant_message',
              text: '',
            }
            yield* emit({ type: 'item.started', item: assistant })
            yield* emitChunks(emit, assistant.id, input.text)
            yield* emit({ type: 'context.updated', usage: echoContextUsage(ramp[2]!) })
            while (queue.messages.length > 0) {
              const steered = yield* Queue.take(queue)
              yield* emitChunks(emit, assistant.id, steered)
            }
            session.accepting = false
            yield* emit({ type: 'item.completed', itemId: assistant.id })

            yield* emit({ type: 'context.updated', usage: echoContextUsage(ramp[3]!) })
            yield* emit({
              type: 'turn.completed',
              turnId: input.turnId,
              usage: { inputTokens: input.text.length, outputTokens: input.text.length },
              costUsd: 0,
            })

            // Plausible fixed numbers so home UI is developable without the real agent.
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

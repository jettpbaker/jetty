import type { ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'
import { Effect, Layer, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'

import type { Store } from './store'

import { AgentError, AgentService, type Agent, type AgentImage, type TurnInput } from './agent'
import { openGrokConnection } from './grok-rpc'
import { createGrokTranslator } from './grok-translate'
import {
  createStdioTurns,
  object,
  string,
  type RpcId,
  type RpcMessage,
  type StdioProcessOptions,
  type StdioSession,
} from './stdio-rpc'

export type GrokOptions = StdioProcessOptions & { interruptGraceMs?: number }
type Pending = {
  id: RpcId
  options?: Record<string, unknown>[]
  questions?: { id: string; question: string; multiSelect: boolean }[]
}
type Session = StdioSession<Pending> & {
  translator: ReturnType<typeof createGrokTranslator>
  requestId?: RpcId
  promptId?: string
  promptCount: number
  next?: { text: string; images?: AgentImage[] }
}

function grokInput(text: string, images?: AgentImage[]) {
  return [
    { type: 'text', text },
    ...(images ?? []).map((image) => ({
      type: 'image',
      data: image.base64data,
      mimeType: image.mimeType,
    })),
  ]
}

export function grokArgs(input: TurnInput) {
  return [
    '--no-plan',
    '--permission-mode',
    input.permissionMode === 'full_access' ? 'bypassPermissions' : 'auto',
    '--sandbox',
    input.permissionMode === 'full_access' ? 'off' : 'workspace',
    'agent',
    '--no-leader',
    'stdio',
  ]
}

export function createGrokAdapter(store: Store, options: GrokOptions = {}) {
  return Effect.gen(function* () {
    const owner = yield* Effect.scope
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const turns = yield* createStdioTurns<Pending, Session>(store)

    function handleRequest(session: Session, message: RpcMessage) {
      return Effect.gen(function* () {
        const connection = session.connection!
        const { id, method } = message
        const params = message.params.params ? object(message.params.params) : message.params
        if (id === undefined) return
        if (session.next || params.sessionId !== session.providerThreadId) {
          yield* connection.reject(id, 'Request does not belong to the active Jetty session')
          return
        }
        if (method === 'x.ai/exit_plan_mode' || method === '_x.ai/exit_plan_mode') {
          yield* connection.respond(id, {
            outcome: 'abandoned',
            feedback: 'Plan mode is disabled in Jetty.',
          })
          return
        }
        const itemId = newId()
        const base = { id: itemId, turnId: session.input.turnId, createdAt: Date.now() }
        if (method === 'session/request_permission') {
          const options = Array.isArray(params.options) ? params.options.map(object) : []
          const tool = object(params.toolCall)
          if (!options.some((o) => o.kind === 'allow_once' && string(o.optionId))) {
            yield* connection.respond(id, { outcome: { outcome: 'cancelled' } })
            return
          }
          session.pending.set(itemId, { id, options })
          yield* session.emit({
            type: 'item.started',
            item: {
              ...base,
              kind: 'approval',
              title: string(tool.title) || 'Run tool',
              toolName: string(tool.kind) || 'tool',
              input: tool.rawInput ?? {},
              suggestions: [],
            },
          })
        } else if (method === 'x.ai/ask_user_question' || method === '_x.ai/ask_user_question') {
          if (params.mode === 'plan') {
            yield* connection.respond(id, { outcome: 'cancelled' })
            return
          }
          const questions = Array.isArray(params.questions) ? params.questions.map(object) : []
          if (!questions.length || questions.some((q) => !string(q.question))) {
            yield* connection.reject(id, 'Malformed question request')
            return
          }
          session.pending.set(itemId, {
            id,
            questions: questions.map((q) => ({
              id: string(q.id) || string(q.question),
              question: string(q.question),
              multiSelect: q.multiSelect === true,
            })),
          })
          yield* session.emit({
            type: 'item.started',
            item: {
              ...base,
              kind: 'question',
              questions: questions.map((q) => ({
                question: string(q.question),
                header: 'Question',
                multiSelect: q.multiSelect === true,
                options: Array.isArray(q.options)
                  ? q.options.map((o) => ({
                      label: string(object(o).label),
                      description: string(object(o).description),
                    }))
                  : [],
              })),
            },
          })
        } else {
          yield* connection.reject(id, 'Jetty does not support ' + method)
          return
        }
        yield* session.emit({ type: 'session.status', status: 'awaiting_approval' })
      })
    }

    function prompt(session: Session, text: string, images?: AgentImage[]) {
      return Effect.gen(function* () {
        session.promptCount++
        session.promptId = newId()
        session.requestId = yield* session.connection!.startRequest('session/prompt', {
          sessionId: session.providerThreadId,
          prompt: grokInput(text, images),
          _meta: { promptId: session.promptId, requestId: session.promptId },
        })
      })
    }

    function run(session: Session, cwd: string) {
      return Effect.gen(function* () {
        const { connection, init } = yield* openGrokConnection(
          cwd,
          grokArgs(session.input),
          options
        ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
        session.connection = connection
        const resume = yield* store.getProviderSessionId(session.input.threadId, 'grok')
        if (resume && object(init.agentCapabilities).loadSession !== true)
          return yield* Effect.fail(
            new AgentError('Grok does not support loading the saved session')
          )
        const result = yield* connection.request(resume ? 'session/load' : 'session/new', {
          cwd,
          mcpServers: [],
          ...(resume ? { sessionId: resume } : {}),
        })
        const sessionId = resume ?? string(result.sessionId)
        if (!sessionId) return yield* Effect.fail(new AgentError('Grok returned no session id'))
        session.providerThreadId = sessionId
        yield* store.setProviderSessionId(session.input.threadId, 'grok', sessionId)
        const requestedModel = session.input.model ?? process.env.JETTY_GROK_MODEL
        const explicitModel = requestedModel !== 'grok-build' && requestedModel
        if (explicitModel || session.input.effort) {
          const modelId = explicitModel || string(object(result.models).currentModelId)
          if (!modelId)
            return yield* Effect.fail(new AgentError('Grok did not advertise a current model'))
          yield* connection.request('session/set_model', {
            sessionId,
            modelId,
            ...(session.input.effort ? { _meta: { reasoningEffort: session.input.effort } } : {}),
          })
        }
        // session/load replays history the ledger already holds.
        for (const message of yield* Queue.takeAll(connection.messages)) {
          if (message.id !== undefined) yield* connection.reject(message.id, 'Session is loading')
        }
        yield* session.emit({ type: 'turn.started', turnId: session.input.turnId })
        yield* prompt(session, session.input.text, session.input.images)
        session.accepting = true
        while (true) {
          const message = yield* Queue.take(connection.messages)
          const terminal = yield* session.publication.withPermit(
            Effect.gen(function* () {
              if (message.id !== undefined) {
                yield* handleRequest(session, message)
                return null
              }
              const response =
                message.method === '$response' && message.params.requestId === session.requestId
              const completion =
                message.method === '_x.ai/session/prompt_complete' &&
                message.params.sessionId === sessionId &&
                (message.params.promptId === session.promptId ||
                  (!message.params.promptId && session.promptCount === 1))
              if (response || completion) {
                const result = response ? object(message.params.result) : message.params
                if (session.next) {
                  const next = session.next
                  session.next = undefined
                  yield* turns.settleOpenItems(session)
                  session.translator = createGrokTranslator(session.input.turnId)
                  yield* session.emit({ type: 'session.status', status: 'running' })
                  yield* prompt(session, next.text, next.images)
                  return null
                }
                session.accepting = false
                yield* turns.settleOpenItems(session)
                const error =
                  string(object(message.params.error).message) ||
                  (result.stopReason !== 'end_turn'
                    ? string(object(result.agentResult).message) ||
                      string(result.agentResult) ||
                      'Grok stopped: ' + String(result.stopReason ?? 'missing stop reason')
                    : '')
                return error || session.reason
                  ? ({
                      type: 'turn.failed',
                      turnId: session.input.turnId,
                      error: session.reason ?? error,
                    } satisfies ThreadEvent)
                  : ({
                      type: 'turn.completed',
                      turnId: session.input.turnId,
                    } satisfies ThreadEvent)
              }
              if (message.method === 'session/update' && message.params.sessionId === sessionId) {
                for (const event of session.translator.translate(object(message.params.update)))
                  yield* session.emit(event)
              }
              return null
            })
          )
          if (terminal) return terminal
        }
      })
    }

    return {
      startTurn(input, emit) {
        return turns.startTurn(
          input,
          emit,
          (base) => ({ ...base, translator: createGrokTranslator(input.turnId), promptCount: 0 }),
          run
        )
      },
      steer(threadId, text, images?: AgentImage[], beforeAccept = Effect.void) {
        return turns.withSession(threadId, (session) =>
          Effect.gen(function* () {
            if (!session.accepting || !session.connection || session.next) return false
            yield* beforeAccept
            session.next = { text, images }
            for (const pending of session.pending.values()) {
              yield* session.connection.respond(
                pending.id,
                pending.questions ? { outcome: 'cancelled' } : { outcome: { outcome: 'cancelled' } }
              )
            }
            yield* session.connection.notify('session/cancel', {
              sessionId: session.providerThreadId,
            })
            const promptId = session.promptId
            yield* Effect.sleep(options.interruptGraceMs ?? 2000).pipe(
              Effect.andThen(
                Effect.suspend(() =>
                  session.next && session.promptId === promptId
                    ? turns.stopOnFailure(session, 'Grok did not acknowledge steering cancellation')
                    : Effect.void
                )
              ),
              Effect.forkIn(owner)
            )
            return true
          })
        )
      },
      interrupt(threadId, reason = 'interrupted') {
        return turns.interrupt(threadId, reason, options.interruptGraceMs ?? 2000, (session) =>
          session.connection && session.providerThreadId
            ? session.connection.notify('session/cancel', { sessionId: session.providerThreadId })
            : Effect.void
        )
      },
      respondToApproval(threadId, itemId, decision, message?: string) {
        const kind = decision === 'allow' ? 'allow_once' : 'reject_once'
        return turns.respond(
          threadId,
          itemId,
          (pending, session) => {
            if (session.next || pending.questions) return undefined
            const option = pending.options?.find((o) => o.kind === kind)
            return {
              outcome: option
                ? { outcome: 'selected', optionId: option.optionId }
                : { outcome: 'cancelled' },
            }
          },
          { decision, ...(message ? { deniedReason: message } : {}) }
        )
      },
      respondToQuestion(threadId, itemId, answers) {
        return turns.respond(
          threadId,
          itemId,
          (pending, session) =>
            !session.next &&
            pending.questions && {
              outcome: 'accepted',
              answers: Object.fromEntries(
                pending.questions.map((q) => {
                  const answer = answers[q.question]
                  return [
                    q.id,
                    answer === undefined
                      ? []
                      : q.multiSelect
                        ? answer.split(',').map((s) => s.trim())
                        : [answer],
                  ]
                })
              ),
            },
          { answers }
        )
      },
    } satisfies Agent
  })
}

export function grokLayer(store: Store, options: GrokOptions = {}) {
  return Layer.effect(AgentService, createGrokAdapter(store, options))
}

import type { ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'
import { Effect, Layer, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'

import type { Store } from './store'

import { AgentError, AgentService, type Agent, type AgentImage, type TurnInput } from './agent'
import { openCodexConnection } from './codex-rpc'
import { createCodexTranslator } from './codex-translate'
import {
  createStdioTurns,
  object,
  string,
  type RpcId,
  type RpcMessage,
  type StdioProcessOptions,
  type StdioSession,
} from './stdio-rpc'

export type CodexOptions = StdioProcessOptions & { interruptGraceMs?: number }
type Pending = { id: RpcId; questions?: { id: string; question: string }[] }
type Session = StdioSession<Pending> & {
  translator: ReturnType<typeof createCodexTranslator>
  providerTurnId?: string
}

function codexInput(text: string, images?: AgentImage[]) {
  return [
    { type: 'text', text, text_elements: [] },
    ...(images ?? []).map((image) => ({
      type: 'image',
      url: `data:${image.mimeType};base64,${image.base64data}`,
    })),
  ]
}

function threadOptions(input: TurnInput, cwd: string) {
  const full = input.permissionMode === 'full_access'
  return {
    cwd,
    model: input.model ?? process.env.JETTY_CODEX_MODEL,
    serviceTier: 'default',
    approvalPolicy: full ? 'never' : 'on-request',
    approvalsReviewer: 'user',
    developerInstructions: '',
    sandbox: full ? 'danger-full-access' : 'workspace-write',
  }
}

export function createCodexAdapter(store: Store, options: CodexOptions = {}) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const turns = yield* createStdioTurns<Pending, Session>(store)

    function handleRequest(session: Session, message: RpcMessage) {
      return Effect.gen(function* () {
        const connection = session.connection!
        const { id, method, params } = message
        if (id === undefined) return
        if (
          params.threadId !== session.providerThreadId ||
          params.turnId !== session.providerTurnId
        ) {
          yield* connection.reject(id, 'Request does not belong to the active Jetty turn')
          return
        }
        const itemId = newId()
        const base = { id: itemId, turnId: session.input.turnId, createdAt: Date.now() }
        if (
          method === 'item/commandExecution/requestApproval' ||
          method === 'item/fileChange/requestApproval'
        ) {
          session.pending.set(itemId, { id })
          yield* session.emit({
            type: 'item.started',
            item: {
              ...base,
              kind: 'approval',
              title: string(params.reason) || string(params.command) || 'Apply file changes',
              toolName:
                method === 'item/fileChange/requestApproval' ? 'fileChange' : 'commandExecution',
              input: params,
              suggestions: [],
            },
          })
        } else if (method === 'item/tool/requestUserInput') {
          const questions = Array.isArray(params.questions) ? params.questions.map(object) : []
          if (
            questions.length === 0 ||
            questions.some((q) => !string(q.id) || !string(q.question) || q.isSecret === true)
          ) {
            yield* connection.reject(id, 'Unsupported or malformed user input request')
            return
          }
          session.pending.set(itemId, {
            id,
            questions: questions.map((q) => ({ id: string(q.id), question: string(q.question) })),
          })
          yield* session.emit({
            type: 'item.started',
            item: {
              ...base,
              kind: 'question',
              questions: questions.map((q) => ({
                question: string(q.question),
                header: string(q.header),
                multiSelect: false,
                options: Array.isArray(q.options)
                  ? q.options.map((option) => ({
                      label: string(object(option).label),
                      description: string(object(option).description),
                    }))
                  : [],
              })),
            },
          })
        } else {
          yield* connection.reject(id, `Jetty does not support ${method}`)
          return
        }
        yield* session.emit({ type: 'session.status', status: 'awaiting_approval' })
      })
    }

    function run(session: Session, cwd: string) {
      return Effect.gen(function* () {
        const connection = yield* openCodexConnection(cwd, options).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
        )
        session.connection = connection
        const resume = yield* store.getProviderSessionId(session.input.threadId, 'codex')
        const result = yield* connection.request(resume ? 'thread/resume' : 'thread/start', {
          ...threadOptions(session.input, cwd),
          ...(resume ? { threadId: resume } : { ephemeral: false }),
        })
        const threadId = string(object(result.thread).id)
        if (!threadId) return yield* Effect.fail(new AgentError('Codex returned no thread id'))
        session.providerThreadId = threadId
        yield* store.setProviderSessionId(session.input.threadId, 'codex', threadId)
        yield* session.emit({ type: 'turn.started', turnId: session.input.turnId })
        const turn = yield* connection.request('turn/start', {
          threadId,
          input: codexInput(session.input.text, session.input.images),
          effort: session.input.effort,
        })
        session.providerTurnId = string(object(turn.turn).id)
        if (!session.providerTurnId)
          return yield* Effect.fail(new AgentError('Codex returned no turn id'))
        session.accepting = true
        while (true) {
          const message = yield* Queue.take(connection.messages)
          const terminal = yield* session.publication.withPermit(
            Effect.gen(function* () {
              if (message.id !== undefined) {
                yield* handleRequest(session, message)
                return null
              }
              if (message.params.threadId !== threadId) return null
              const eventTurn = message.params.turnId ?? object(message.params.turn).id
              if (eventTurn !== session.providerTurnId) return null
              if (message.method === 'turn/completed') {
                session.accepting = false
                yield* turns.settleOpenItems(session)
                const completed = object(message.params.turn)
                return completed.status === 'completed' && session.reason === null
                  ? ({ type: 'turn.completed', turnId: session.input.turnId } satisfies ThreadEvent)
                  : ({
                      type: 'turn.failed',
                      turnId: session.input.turnId,
                      error:
                        session.reason ??
                        (string(object(completed.error).message) ||
                          string(completed.status) ||
                          'Codex turn failed'),
                    } satisfies ThreadEvent)
              }
              for (const event of session.translator.translate(message)) yield* session.emit(event)
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
          (base) => ({ ...base, translator: createCodexTranslator(input.turnId) }),
          run
        )
      },
      steer(threadId, text, images?: AgentImage[], beforeAccept = Effect.void) {
        return turns.withSession(threadId, (session) =>
          Effect.gen(function* () {
            if (!session.accepting || !session.connection) return false
            yield* beforeAccept
            yield* session.connection.request('turn/steer', {
              threadId: session.providerThreadId,
              expectedTurnId: session.providerTurnId,
              input: codexInput(text, images),
            })
            return true
          })
        )
      },
      interrupt(threadId, reason = 'interrupted') {
        return turns.interrupt(threadId, reason, options.interruptGraceMs ?? 2000, (session) =>
          session.connection && session.providerTurnId
            ? session.connection.request('turn/interrupt', {
                threadId: session.providerThreadId,
                turnId: session.providerTurnId,
              })
            : Effect.void
        )
      },
      respondToApproval(threadId, itemId, decision, message?: string) {
        return turns.respond(
          threadId,
          itemId,
          (pending) =>
            pending.questions
              ? undefined
              : { decision: decision === 'allow' ? 'accept' : 'decline' },
          { decision, ...(message ? { deniedReason: message } : {}) }
        )
      },
      respondToQuestion(threadId, itemId, answers) {
        return turns.respond(
          threadId,
          itemId,
          (pending) =>
            pending.questions && {
              answers: Object.fromEntries(
                pending.questions.map((q) => [
                  q.id,
                  { answers: answers[q.question] === undefined ? [] : [answers[q.question]] },
                ])
              ),
            },
          { answers }
        )
      },
    } satisfies Agent
  })
}

export function codexLayer(store: Store, options: CodexOptions = {}) {
  return Layer.effect(AgentService, createCodexAdapter(store, options))
}

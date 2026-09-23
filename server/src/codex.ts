import type { ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'
import { Deferred, Effect, Fiber, Layer, Queue, Semaphore } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'

import type { Store } from './store'

import {
  AgentError,
  AgentService,
  type Agent,
  type AgentImage,
  type Emit,
  type TurnInput,
} from './agent'
import {
  object,
  openCodexConnection,
  string,
  type CodexConnection,
  type CodexProcessOptions,
  type RpcId,
  type RpcMessage,
} from './codex-rpc'
import { createCodexTranslator } from './codex-translate'

export type CodexOptions = CodexProcessOptions & { interruptGraceMs?: number }
type Pending = { id: RpcId; questions?: { id: string; question: string }[] }
type Session = {
  input: TurnInput
  emit: Emit
  translator: ReturnType<typeof createCodexTranslator>
  connection?: CodexConnection
  providerThreadId?: string
  providerTurnId?: string
  accepting: boolean
  settled: boolean
  reason: string | null
  pending: Map<string, Pending>
  publication: Semaphore.Semaphore
  fiber?: Fiber.Fiber<void, AgentError>
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
    const owner = yield* Effect.scope
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const sessions = new Map<string, Session>()
    const admission = yield* Semaphore.make(1)

    function settleOpenItems(session: Session) {
      return Effect.gen(function* () {
        for (const [itemId, pending] of session.pending) {
          yield* session.emit({
            type: 'item.completed',
            itemId,
            patch: pending.questions
              ? { skipped: true }
              : { decision: 'deny', deniedReason: session.reason ?? 'Turn ended' },
          })
        }
        session.pending.clear()
        for (const event of session.translator.finish()) yield* session.emit(event)
      })
    }

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
      return Effect.scoped(
        Effect.gen(function* () {
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
          const translator = session.translator
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
                  yield* settleOpenItems(session)
                  const completed = object(message.params.turn)
                  return completed.status === 'completed' && session.reason === null
                    ? ({
                        type: 'turn.completed',
                        turnId: session.input.turnId,
                      } satisfies ThreadEvent)
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
                for (const event of translator.translate(message)) yield* session.emit(event)
                return null
              })
            )
            if (terminal) return terminal
          }
        })
      ).pipe(
        Effect.flatMap((terminal) =>
          session.publication.withPermit(
            session.emit(
              terminal,
              Effect.sync(() => {
                session.settled = true
                if (sessions.get(session.input.threadId) === session)
                  sessions.delete(session.input.threadId)
              })
            )
          )
        ),
        Effect.mapError((error) =>
          error instanceof AgentError ? error : new AgentError(error.message)
        )
      )
    }

    return {
      startTurn(input, emit) {
        return Effect.gen(function* () {
          if (sessions.has(input.threadId))
            return yield* Effect.fail(new AgentError('Turn already active'))
          const thread = yield* store.getThread(input.threadId)
          const project = thread && (yield* store.getProject(thread.projectId))
          if (!project) return yield* Effect.fail(new AgentError('Thread project not found'))
          const done = yield* Deferred.make<void, AgentError>()
          const session: Session = {
            input,
            emit,
            translator: createCodexTranslator(input.turnId),
            accepting: false,
            settled: false,
            reason: null,
            pending: new Map(),
            publication: yield* Semaphore.make(1),
          }
          sessions.set(input.threadId, session)
          const lifecycle = run(session, project.path).pipe(
            Effect.onInterrupt(() =>
              session.publication
                .withPermit(
                  Effect.gen(function* () {
                    session.accepting = false
                    if (session.settled) return
                    yield* settleOpenItems(session).pipe(Effect.ignore)
                    yield* emit({
                      type: 'turn.failed',
                      turnId: input.turnId,
                      error: session.reason ?? 'server shutdown',
                    })
                  })
                )
                .pipe(Effect.ignore)
            ),
            Effect.onError(() =>
              session.publication
                .withPermit(
                  Effect.gen(function* () {
                    session.accepting = false
                    yield* settleOpenItems(session)
                  })
                )
                .pipe(Effect.ignore)
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (sessions.get(input.threadId) === session) sessions.delete(input.threadId)
              })
            ),
            Effect.onExit((exit) => Deferred.done(done, exit))
          )
          session.fiber = yield* Effect.forkIn(lifecycle, owner)
          return { await: Deferred.await(done) }
        }).pipe(
          Effect.mapError((error) =>
            error instanceof AgentError ? error : new AgentError(error.message)
          ),
          admission.withPermit
        )
      },
      steer(threadId, text, images?: AgentImage[], beforeAccept = Effect.void) {
        return Effect.suspend(() => {
          const session = sessions.get(threadId)
          if (!session) return Effect.succeed(false)
          return session.publication
            .withPermit(
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
            .pipe(
              Effect.uninterruptible,
              Effect.onError((cause) => stopOnFailure(session, String(cause)))
            )
        })
      },
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
          if (session.connection && session.providerTurnId) {
            yield* session.connection
              .request('turn/interrupt', {
                threadId: session.providerThreadId,
                turnId: session.providerTurnId,
              })
              .pipe(Effect.timeout(options.interruptGraceMs ?? 2000), Effect.ignore)
          }
          if (session.fiber) yield* Fiber.interrupt(session.fiber)
        })
      },
      respondToApproval(threadId, itemId, decision, message?: string) {
        return respond(
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
        return respond(
          threadId,
          itemId,
          (pending) =>
            pending.questions
              ? {
                  answers: Object.fromEntries(
                    pending.questions.map((q) => [
                      q.id,
                      { answers: answers[q.question] === undefined ? [] : [answers[q.question]] },
                    ])
                  ),
                }
              : undefined,
          { answers }
        )
      },
    } satisfies Agent

    function respond(
      threadId: string,
      itemId: string,
      result: (pending: Pending) => unknown,
      patch: Record<string, unknown>
    ) {
      return Effect.suspend(() => {
        const session = sessions.get(threadId)
        if (!session) return Effect.succeed(false)
        return session.publication
          .withPermit(
            Effect.gen(function* () {
              const pending = session.pending.get(itemId)
              if (!session.accepting || !pending || !session.connection) return false
              const response = result(pending)
              if (!response) return false
              yield* session.emit(
                { type: 'item.completed', itemId, patch },
                Effect.sync(() => {
                  session.pending.delete(itemId)
                })
              )
              yield* session.connection.respond(pending.id, response)
              yield* session.emit({
                type: 'session.status',
                status: session.pending.size ? 'awaiting_approval' : 'running',
              })
              return true
            })
          )
          .pipe(
            Effect.uninterruptible,
            Effect.onError((cause) => stopOnFailure(session, String(cause)))
          )
      })
    }

    function stopOnFailure(session: Session, reason: string) {
      return Effect.gen(function* () {
        session.reason = reason
        session.accepting = false
        if (session.fiber) yield* Fiber.interrupt(session.fiber)
      })
    }
  })
}

export function codexLayer(store: Store, options: CodexOptions = {}) {
  return Layer.effect(AgentService, createCodexAdapter(store, options))
}

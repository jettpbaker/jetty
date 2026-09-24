import type { ThreadEvent } from '@jetty/shared/events'

import { newId } from '@jetty/shared/wire'
import { Deferred, Effect, Fiber, Layer, Queue, Semaphore } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'

import type { McpSessions } from './mcp-sessions'
import type { Store } from './store'

import {
  AgentError,
  AgentService,
  type Agent,
  type AgentImage,
  type Emit,
  type TurnInput,
} from './agent'
import { approvalChanges, approvalInputWithoutChanges } from './approval-changes'
import { foldGrokModels } from './grok-models'
import { openGrokConnection } from './grok-rpc'
import { createGrokTranslator } from './grok-translate'
import { JETTY_INSTRUCTIONS } from './jetty-instructions'
import {
  object,
  string,
  type StdioConnection,
  type StdioProcessOptions,
  type RpcId,
  type RpcMessage,
} from './stdio-rpc'

export type GrokOptions = StdioProcessOptions & {
  interruptGraceMs?: number
  ttlMs?: number
  mcp?: McpSessions
}
type Pending = {
  id: RpcId
  options?: Record<string, unknown>[]
  questions?: { id: string; question: string; multiSelect: boolean }[]
}
type Session = {
  input: TurnInput
  emit: Emit
  translator: ReturnType<typeof createGrokTranslator>
  connection?: StdioConnection
  providerThreadId?: string
  requestId?: RpcId
  promptId?: string
  promptCount: number
  next?: { text: string; images?: AgentImage[] }
  accepting: boolean
  awaitingResult: boolean
  done: Deferred.Deferred<void, AgentError>
  idle: Fiber.Fiber<void> | null
  runningWorkflows: Set<string>
  runningSubagents: Set<string>
  settings: string
  modelId?: string
  effort?: TurnInput['effort']
  fastIds: Map<string, string>
  reason: string | null
  pending: Map<string, Pending>
  publication: Semaphore.Semaphore
  fiber?: Fiber.Fiber<void, AgentError>
}

function grokInput(text: string, images?: AgentImage[]) {
  return [
    ...(text ? [{ type: 'text', text }] : []),
    ...(images ?? []).map((image) => ({
      type: 'image',
      data: image.base64data,
      mimeType: image.mimeType,
    })),
  ]
}

export function grokArgs(input: TurnInput, jettyTools = false) {
  return [
    '--no-plan',
    '--permission-mode',
    input.permissionMode === 'full_access' ? 'bypassPermissions' : 'auto',
    '--sandbox',
    input.permissionMode === 'full_access' || input.environment ? 'off' : 'workspace',
    ...(jettyTools ? ['--rules', JETTY_INSTRUCTIONS] : []),
    'agent',
    '--no-leader',
    'stdio',
  ]
}

function grokModel(input: TurnInput, currentId: string, fastIds: Map<string, string>) {
  const baseOf = new Map([...fastIds].map(([base, fast]) => [fast, base]))
  const baseId =
    input.model && input.model !== 'grok-build' ? input.model : (baseOf.get(currentId) ?? currentId)
  return input.fast ? (fastIds.get(baseId) ?? baseId) : baseId
}

export function createGrokAdapter(store: Store, options: GrokOptions = {}) {
  return Effect.gen(function* () {
    const owner = yield* Effect.scope
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const sessions = new Map<string, Session>()
    const admission = yield* Semaphore.make(1)
    const ttlMs = options.ttlMs ?? Number(process.env.JETTY_SESSION_TTL_MS ?? 10 * 60 * 1000)

    function armIdle(session: Session) {
      return Effect.gen(function* () {
        if (
          session.awaitingResult ||
          session.runningWorkflows.size ||
          session.runningSubagents.size
        )
          return
        if (session.idle) yield* Fiber.interrupt(session.idle)
        session.idle = yield* Effect.sleep(ttlMs).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              !session.awaitingResult &&
              !session.runningWorkflows.size &&
              !session.runningSubagents.size &&
              sessions.get(session.input.threadId) === session &&
              session.fiber
                ? Fiber.interrupt(session.fiber).pipe(Effect.forkIn(owner), Effect.asVoid)
                : Effect.void
            )
          ),
          Effect.forkIn(owner)
        )
      })
    }

    function publish(session: Session, event: ThreadEvent) {
      return Effect.gen(function* () {
        yield* session.emit(event)
        if (event.type === 'item.started' && event.item.kind === 'workflow')
          session.runningWorkflows.add(event.item.id)
        if (event.type === 'item.completed') session.runningWorkflows.delete(event.itemId)
        if (session.runningWorkflows.size || session.runningSubagents.size) {
          if (session.idle) yield* Fiber.interrupt(session.idle)
          session.idle = null
        } else if (!session.awaitingResult) yield* armIdle(session)
      })
    }

    function settleOpenItems(session: Session) {
      return Effect.gen(function* () {
        for (const [itemId, pending] of session.pending) {
          yield* publish(session, {
            type: 'item.completed',
            itemId,
            patch: pending.questions
              ? { skipped: true }
              : { decision: 'deny', deniedReason: session.reason ?? 'Turn ended' },
          })
        }
        session.pending.clear()
        for (const event of session.translator.finish()) yield* publish(session, event)
      })
    }

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
          const allow = options.find((o) => o.kind === 'allow_once' && string(o.optionId))
          const input = object(tool.rawInput)
          if (
            input.variant === 'UseTool' &&
            input.tool_name === 'jetty__mark_ready_for_review' &&
            allow
          ) {
            yield* connection.respond(id, {
              outcome: { outcome: 'selected', optionId: allow.optionId },
            })
            return
          }
          if (!allow) {
            yield* connection.respond(id, { outcome: { outcome: 'cancelled' } })
            return
          }
          session.pending.set(itemId, { id, options })
          const changes = approvalChanges(string(tool.kind), tool.rawInput)
          yield* session.emit({
            type: 'item.started',
            item: {
              ...base,
              kind: 'approval',
              title: string(tool.title) || 'Run tool',
              toolName: string(tool.kind) || 'tool',
              input: changes.length
                ? approvalInputWithoutChanges(object(tool.rawInput))
                : (tool.rawInput ?? {}),
              suggestions: [],
              ...(changes.length ? { changes } : {}),
              ...(options.some((o) => o.kind === 'allow_always' && string(o.optionId))
                ? { always: { scope: 'session' as const, patterns: [] } }
                : {}),
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
      return Effect.scoped(
        Effect.gen(function* () {
          const binding = options.mcp
            ? yield* options.mcp.open(
                { threadId: session.input.threadId, provider: 'grok' },
                Boolean(session.input.environment)
              )
            : undefined
          const target = session.input.environment
          const { connection, init } = yield* openGrokConnection(
            target?.hostCheckout ?? cwd,
            grokArgs(session.input, Boolean(binding)),
            target
              ? {
                  ...options,
                  command: 'docker',
                  args: [
                    'exec',
                    '-i',
                    '-w',
                    '/workspace',
                    ...Object.entries(target.providerEnv).flatMap(([name, value]) => [
                      '-e',
                      `${name}=${value}`,
                    ]),
                    target.containerId,
                    'sh',
                    '-c',
                    'echo $$ > /artifacts/.jetty-provider.pid; exec "$@"',
                    'jetty',
                    'grok',
                    ...grokArgs(session.input, Boolean(binding)),
                  ],
                  authMethod: 'xai.api_key',
                }
              : options
          ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
          session.connection = connection
          const resume = yield* store.getProviderSessionId(session.input.threadId, 'grok')
          if (resume && object(init.agentCapabilities).loadSession !== true)
            return yield* Effect.fail(
              new AgentError('Grok does not support loading the saved session')
            )
          const result = yield* connection.request(resume ? 'session/load' : 'session/new', {
            cwd: target?.agentCwd ?? cwd,
            mcpServers: binding
              ? [
                  {
                    type: 'http',
                    name: 'jetty',
                    url: binding.url,
                    headers: [{ name: 'Authorization', value: `Bearer ${binding.token}` }],
                  },
                ]
              : [],
            ...(resume ? { sessionId: resume } : {}),
          })
          const sessionId = resume ?? string(result.sessionId)
          if (!sessionId) return yield* Effect.fail(new AgentError('Grok returned no session id'))
          session.providerThreadId = sessionId
          yield* store.setProviderSessionId(session.input.threadId, 'grok', sessionId)
          const currentId = string(object(result.models).currentModelId)
          const { fastIds } = foldGrokModels(object(result.models).availableModels)
          session.fastIds = fastIds
          const modelId = grokModel(session.input, currentId, fastIds)
          if (!modelId)
            return yield* Effect.fail(new AgentError('Grok did not advertise a current model'))
          yield* connection.request('session/set_model', {
            sessionId,
            modelId,
            ...(session.input.effort ? { _meta: { reasoningEffort: session.input.effort } } : {}),
          })
          session.modelId = modelId
          session.effort = session.input.effort
          // Loading replays history; the ledger already owns those messages.
          for (const message of yield* Queue.takeAll(connection.messages)) {
            if (message.id !== undefined) yield* connection.reject(message.id, 'Session is loading')
          }
          yield* publish(session, { type: 'turn.started', turnId: session.input.turnId })
          yield* prompt(session, session.input.text, session.input.images)
          session.accepting = true
          while (true) {
            const message = yield* Queue.take(connection.messages)
            yield* session.publication.withPermit(
              Effect.gen(function* () {
                if (message.id !== undefined) {
                  yield* handleRequest(session, message)
                  return
                }
                const update = object(message.params.update)
                const notification =
                  (message.method === 'session/update' ||
                    message.method === '_x.ai/session/update' ||
                    message.method === '_x.ai/session_notification') &&
                  message.params.sessionId === sessionId
                if (notification) {
                  if (update.sessionUpdate === 'subagent_spawned') {
                    const id = string(update.subagent_id)
                    if (id) session.runningSubagents.add(id)
                  } else if (update.sessionUpdate === 'subagent_finished') {
                    session.runningSubagents.delete(string(update.subagent_id))
                  }
                  if (
                    !session.awaitingResult &&
                    (update.sessionUpdate === 'agent_message_chunk' ||
                      update.sessionUpdate === 'agent_thought_chunk' ||
                      update.sessionUpdate === 'tool_call')
                  ) {
                    session.input = { ...session.input, turnId: newId(), text: '' }
                    session.translator = createGrokTranslator(
                      session.input.turnId,
                      session.translator.workflows
                    )
                    session.awaitingResult = true
                    session.accepting = true
                    session.done = yield* Deferred.make<void, AgentError>()
                    session.promptId = string(object(message.params._meta).promptId) || undefined
                    session.requestId = undefined
                    if (session.idle) yield* Fiber.interrupt(session.idle)
                    session.idle = null
                    yield* publish(session, { type: 'turn.started', turnId: session.input.turnId })
                  }
                  for (const event of session.translator.translate(update))
                    yield* publish(session, event)
                  if (
                    update.sessionUpdate === 'turn_completed' &&
                    session.awaitingResult &&
                    session.requestId === undefined &&
                    update.prompt_id === session.promptId
                  ) {
                    session.accepting = false
                    yield* settleOpenItems(session)
                    session.awaitingResult = false
                    session.promptId = undefined
                    yield* session.emit(
                      update.stop_reason === 'end_turn'
                        ? { type: 'turn.completed', turnId: session.input.turnId }
                        : {
                            type: 'turn.failed',
                            turnId: session.input.turnId,
                            error: 'Grok stopped: ' + String(update.stop_reason ?? 'unknown'),
                          }
                    )
                    yield* Deferred.succeed(session.done, undefined)
                  }
                  if (!session.awaitingResult) yield* armIdle(session)
                }
                const response =
                  session.awaitingResult &&
                  session.requestId !== undefined &&
                  message.method === '$response' &&
                  message.params.requestId === session.requestId
                const completion =
                  session.awaitingResult &&
                  message.method === '_x.ai/session/prompt_complete' &&
                  message.params.sessionId === sessionId &&
                  (message.params.promptId === session.promptId ||
                    (!message.params.promptId &&
                      (session.requestId === undefined || session.promptCount === 1)))
                if (response || completion) {
                  const result = response ? object(message.params.result) : message.params
                  if (session.next) {
                    const next = session.next
                    session.next = undefined
                    yield* settleOpenItems(session)
                    session.translator = createGrokTranslator(
                      session.input.turnId,
                      session.translator.workflows
                    )
                    yield* session.emit({ type: 'session.status', status: 'running' })
                    yield* prompt(session, next.text, next.images)
                    return
                  }
                  session.accepting = false
                  yield* settleOpenItems(session)
                  const error =
                    string(object(message.params.error).message) ||
                    (result.stopReason !== 'end_turn'
                      ? string(object(result.agentResult).message) ||
                        string(result.agentResult) ||
                        'Grok stopped: ' + String(result.stopReason ?? 'missing stop reason')
                      : '')
                  const terminal =
                    error || session.reason
                      ? ({
                          type: 'turn.failed',
                          turnId: session.input.turnId,
                          error: session.reason ?? error,
                        } satisfies ThreadEvent)
                      : ({
                          type: 'turn.completed',
                          turnId: session.input.turnId,
                        } satisfies ThreadEvent)
                  session.awaitingResult = false
                  session.requestId = undefined
                  session.promptId = undefined
                  yield* session.emit(terminal)
                  yield* Deferred.succeed(session.done, undefined)
                  yield* armIdle(session)
                }
              })
            )
          }
        })
      ).pipe(
        Effect.mapError((error) =>
          error instanceof AgentError ? error : new AgentError(error.message)
        )
      )
    }

    // Grok advertises /workflow stop as a prompt command, but no task-specific ACP stop request.
    return {
      startTurn(input, emit) {
        return Effect.gen(function* () {
          let existing = sessions.get(input.threadId)
          const settings = JSON.stringify(grokArgs(input))
          if (existing) {
            let retire = false
            yield* existing.publication.withPermit(
              Effect.gen(function* () {
                if (existing!.awaitingResult)
                  return yield* Effect.fail(new AgentError('Turn already active'))
                if (existing!.settings !== settings) {
                  if (existing!.runningWorkflows.size || existing!.runningSubagents.size)
                    return yield* Effect.fail(
                      new AgentError('Grok permission mode cannot change during background work')
                    )
                  retire = true
                  return
                }
                const currentId = existing!.modelId ?? ''
                const modelId = grokModel(input, currentId, existing!.fastIds)
                if (modelId !== currentId || input.effort !== existing!.effort) {
                  yield* existing!.connection!.request('session/set_model', {
                    sessionId: existing!.providerThreadId,
                    modelId,
                    ...(input.effort ? { _meta: { reasoningEffort: input.effort } } : {}),
                  })
                  existing!.modelId = modelId
                  existing!.effort = input.effort
                }
                if (existing!.idle) yield* Fiber.interrupt(existing!.idle)
                existing!.idle = null
                existing!.input = input
                existing!.emit = emit
                existing!.translator = createGrokTranslator(
                  input.turnId,
                  existing!.translator.workflows
                )
                existing!.done = yield* Deferred.make<void, AgentError>()
                existing!.reason = null
                existing!.awaitingResult = true
                existing!.accepting = true
                yield* publish(existing!, { type: 'turn.started', turnId: input.turnId })
                yield* prompt(existing!, input.text, input.images)
              })
            )
            if (retire) {
              if (existing.fiber) yield* Fiber.interrupt(existing.fiber)
              existing = undefined
            }
            if (existing) return { await: Deferred.await(existing.done) }
          }
          const thread = yield* store.getThread(input.threadId)
          const project = thread && (yield* store.getProject(thread.projectId))
          if (!project) return yield* Effect.fail(new AgentError('Thread project not found'))
          const done = yield* Deferred.make<void, AgentError>()
          const session: Session = {
            input,
            emit,
            translator: createGrokTranslator(input.turnId),
            accepting: false,
            awaitingResult: true,
            done,
            idle: null,
            runningWorkflows: new Set(),
            runningSubagents: new Set(),
            settings,
            fastIds: new Map(),
            reason: null,
            pending: new Map(),
            promptCount: 0,
            publication: yield* Semaphore.make(1),
          }
          sessions.set(input.threadId, session)
          function cleanup(reason: string, failed = false) {
            return session.publication
              .withPermit(
                Effect.gen(function* () {
                  session.accepting = false
                  yield* settleOpenItems(session).pipe(Effect.ignore)
                  if (session.awaitingResult) {
                    yield* session
                      .emit({
                        type: 'turn.failed',
                        turnId: session.input.turnId,
                        error: reason,
                      })
                      .pipe(Effect.ignore)
                    session.awaitingResult = false
                  }
                  for (const itemId of session.runningWorkflows)
                    yield* publish(session, {
                      type: 'item.completed',
                      itemId,
                      patch: { status: 'stopped', stopReason: 'crash' },
                    }).pipe(Effect.ignore)
                  if (failed) yield* Deferred.fail(session.done, new AgentError(reason))
                  else yield* Deferred.succeed(session.done, undefined)
                })
              )
              .pipe(Effect.ignore)
          }
          const lifecycle = run(session, project.path).pipe(
            Effect.onInterrupt(() => cleanup(session.reason ?? 'server shutdown')),
            Effect.onError((cause) => cleanup(`Grok session failed: ${String(cause)}`, true)),
            Effect.ensuring(
              Effect.sync(() => {
                if (sessions.get(input.threadId) === session) sessions.delete(input.threadId)
              })
            ),
            Effect.onExit((exit) => Deferred.done(session.done, exit))
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
                if (session.next) return false
                yield* beforeAccept
                session.next = { text, images }
                for (const pending of session.pending.values()) {
                  yield* session.connection.respond(
                    pending.id,
                    pending.questions
                      ? { outcome: 'cancelled' }
                      : { outcome: { outcome: 'cancelled' } }
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
                        ? stopOnFailure(session, 'Grok did not acknowledge steering cancellation')
                        : Effect.void
                    )
                  ),
                  Effect.forkIn(owner)
                )
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
          if (!session || !session.awaitingResult) return
          const promptId = yield* session.publication.withPermit(
            Effect.sync(() => {
              session.reason = reason
              session.accepting = false
              return session.promptId
            })
          )
          if (session.connection && session.providerThreadId) {
            yield* session.connection
              .notify('session/cancel', { sessionId: session.providerThreadId })
              .pipe(Effect.timeout(options.interruptGraceMs ?? 2000), Effect.ignore)
          }
          yield* Effect.sleep(options.interruptGraceMs ?? 2000).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                session.awaitingResult && session.promptId === promptId && session.fiber
                  ? Fiber.interrupt(session.fiber)
                  : Effect.void
              )
            ),
            Effect.forkIn(owner)
          )
        })
      },
      respondToApproval(threadId, itemId, decision, message?: string) {
        return respond(
          threadId,
          itemId,
          (pending) =>
            pending.questions
              ? undefined
              : (() => {
                  const kind =
                    decision === 'deny'
                      ? 'reject_once'
                      : decision === 'always'
                        ? 'allow_always'
                        : 'allow_once'
                  const option =
                    pending.options?.find((o) => o.kind === kind) ??
                    pending.options?.find((o) => o.kind === 'allow_once' && decision !== 'deny')
                  return {
                    outcome: option
                      ? { outcome: 'selected', optionId: option.optionId }
                      : { outcome: 'cancelled' },
                  }
                })(),
          { decision, ...(message ? { deniedReason: message } : {}) }
        )
      },
      respondToQuestion(threadId, itemId, answers) {
        return respond(
          threadId,
          itemId,
          (pending) =>
            !pending.questions
              ? undefined
              : !answers
                ? { outcome: 'cancelled' }
                : {
                    outcome: 'accepted',
                    answers: Object.fromEntries(
                      pending.questions.map((q) => [
                        q.id,
                        answers[q.question] === undefined
                          ? []
                          : q.multiSelect
                            ? answers[q.question]!.split(',').map((s) => s.trim())
                            : [answers[q.question]],
                      ])
                    ),
                  },
          answers ? { answers } : { dismissed: true }
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
              if (!session.accepting || session.next || !pending || !session.connection)
                return false
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

export function grokLayer(store: Store, options: GrokOptions = {}) {
  return Layer.effect(AgentService, createGrokAdapter(store, options))
}

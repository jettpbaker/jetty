import type { ApprovalDecider } from '@jetty/shared/items'

import { newId } from '@jetty/shared/wire'
import { Cause, Deferred, Effect, Fiber, Layer, Queue, Semaphore } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { prepareBotHome } from './bot-home'
import type { McpSessions } from './mcp-sessions'
import type { Store } from './store'

import { acpPermissionOutcome } from './acp-permissions'
import {
  AgentError,
  AgentService,
  couldntCompact,
  type Agent,
  type AgentImage,
  type Emit,
  type TurnInput,
} from './agent'
import { approvalChanges, approvalInputWithoutChanges } from './approval-changes'
import { prepareBot } from './bot-preparation'
import { jettyInstructions } from './jetty-instructions'
import { SELF_TOOLS, THREAD_TOOLS } from './jetty-tools'
import { opencodeConfig, setOpencodeModel } from './opencode-models'
import { opencodeConfigEnv, opencodeError, openOpencodeConnection } from './opencode-rpc'
import {
  opencodeContextUsage,
  opencodeToolInput,
  opencodeToolName,
  createOpencodeTranslator,
} from './opencode-translate'
import {
  object,
  string,
  type RpcId,
  type RpcMessage,
  type StdioConnection,
  type StdioProcessOptions,
} from './stdio-rpc'

export type OpencodeOptions = StdioProcessOptions & {
  interruptGraceMs?: number
  ttlMs?: number
  mcp?: McpSessions
}
type Session = {
  input: TurnInput
  bot?: Awaited<ReturnType<typeof prepareBotHome>>
  emit: Emit
  translator: ReturnType<typeof createOpencodeTranslator>
  connection?: StdioConnection
  providerThreadId?: string
  requestId?: RpcId
  done: Deferred.Deferred<void, AgentError>
  fiber?: Fiber.Fiber<void, AgentError>
  idle: Fiber.Fiber<void> | null
  expired: boolean
  accepting: boolean
  awaitingResult: boolean
  reason: string | null
  stopped: boolean
  denied: boolean
  cwd: string
  full: boolean
  steerUnread: boolean
  steerFolding: boolean
  next?: { text: string; images?: AgentImage[] }
  pending: Map<string, { id: RpcId; options: Record<string, unknown>[] }>
  publication: Semaphore.Semaphore
  config: Record<string, unknown>
  commands: Set<string>
  compactionId?: string
  compactionOutput: string
}

export function opencodeInput(text: string, images?: AgentImage[]) {
  return [
    ...(text ? [{ type: 'text', text }] : []),
    ...(images ?? []).map((image) => ({
      type: 'image',
      data: image.base64data,
      mimeType: image.mimeType,
    })),
  ]
}

// ACP has no field for system instructions. OpenCode reads instruction files named in its config,
// so each session gets one, removed with it.
function instructionsFile(text: string) {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const dir = await mkdtemp(join(tmpdir(), 'jetty-opencode-'))
        await writeFile(join(dir, 'jetty.md'), `${text}\n`)
        return dir
      },
      catch: (error) => new AgentError(`Could not write OpenCode instructions: ${String(error)}`),
    }),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true }))
  )
}

export function createOpencodeAdapter(store: Store, options: OpencodeOptions = {}) {
  return Effect.gen(function* () {
    const owner = yield* Effect.scope
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const sessions = new Map<string, Session>()
    const admission = yield* Semaphore.make(1)
    const graceMs = options.interruptGraceMs ?? 2000
    const ttlMs = options.ttlMs ?? Number(process.env.JETTY_SESSION_TTL_MS ?? 10 * 60 * 1000)

    function armIdle(session: Session) {
      return Effect.gen(function* () {
        if (session.awaitingResult) return
        if (session.idle) yield* Fiber.interrupt(session.idle)
        session.idle = yield* Effect.sleep(ttlMs).pipe(
          Effect.andThen(
            session.publication.withPermit(
              Effect.suspend(() => {
                if (
                  session.awaitingResult ||
                  sessions.get(session.input.threadId) !== session ||
                  !session.fiber
                )
                  return Effect.void
                session.expired = true
                return Fiber.interrupt(session.fiber).pipe(Effect.forkIn(owner), Effect.asVoid)
              })
            )
          ),
          Effect.forkIn(owner)
        )
      })
    }

    function settle(session: Session) {
      return Effect.gen(function* () {
        for (const [itemId] of session.pending)
          yield* session.emit({
            type: 'item.completed',
            itemId,
            patch: { decision: 'deny', deniedReason: session.reason ?? 'Turn ended' },
          })
        session.pending.clear()
        for (const event of session.translator.finish(session.stopped)) yield* session.emit(event)
      })
    }

    function finishCompaction(session: Session, error?: string) {
      return Effect.gen(function* () {
        if (!session.input.compact) return
        if (session.compactionId) {
          yield* session.emit({
            type: 'item.completed',
            itemId: session.compactionId,
            patch: {
              status: session.stopped ? 'running' : error ? 'failed' : 'completed',
              ...(error && !session.stopped ? { error } : {}),
            },
          })
          session.compactionId = undefined
        }
        if (error && !session.stopped)
          yield* session.emit(couldntCompact(session.input.turnId, error))
      })
    }

    function configure(session: Session, input: TurnInput) {
      return Effect.gen(function* () {
        const connection = session.connection!
        const sessionId = session.providerThreadId!
        const modelId =
          input.model ||
          string(opencodeConfig(session.config, 'model', 'model')?.currentValue) ||
          string(object(session.config.models).currentModelId)
        if (!modelId)
          return yield* Effect.fail(new AgentError('OpenCode did not advertise a model'))
        session.config = yield* setOpencodeModel(
          connection,
          sessionId,
          session.config,
          modelId,
          input.effort
        )
        const mode = opencodeConfig(session.config, 'mode', 'mode')
        if (mode) {
          const modes = Array.isArray(mode.options) ? mode.options.map(object) : []
          const build = modes.find((option) => option.value === 'build')
          if (build && mode.currentValue !== build.value)
            yield* connection.request('session/set_config_option', {
              sessionId,
              configId: mode.id,
              value: build.value,
            })
        }
      })
    }

    function prompt(session: Session, text: string, images?: AgentImage[]) {
      return Effect.gen(function* () {
        if (session.stopped)
          return yield* Effect.fail(new AgentError(session.reason ?? 'interrupted'))
        if (session.input.compact) {
          if (!session.commands.has('compact'))
            return yield* Effect.fail(new AgentError('OpenCode does not advertise /compact'))
          session.compactionId = newId()
          session.compactionOutput = ''
          yield* session.emit({
            type: 'item.started',
            item: {
              id: session.compactionId,
              turnId: session.input.turnId,
              createdAt: Date.now(),
              kind: 'compaction',
              status: 'running',
            },
          })
        }
        const blocks = session.input.compact
          ? opencodeInput('/compact')
          : opencodeInput(text, images)
        session.denied = false
        session.requestId = yield* session.connection!.startRequest('session/prompt', {
          sessionId: session.providerThreadId,
          prompt: blocks,
        })
        session.steerFolding = session.steerUnread
      })
    }

    function handleRequest(session: Session, message: RpcMessage) {
      return Effect.gen(function* () {
        const connection = session.connection!
        const { id, method, params } = message
        if (id === undefined) return
        if (!session.accepting || session.next || params.sessionId !== session.providerThreadId) {
          yield* connection.reject(id, 'Request does not belong to an active Jetty turn')
          return
        }
        if (method !== 'session/request_permission') {
          yield* connection.reject(id, 'Jetty does not support ' + method)
          return
        }
        const options = Array.isArray(params.options) ? params.options.map(object) : []
        const tool = object(params.toolCall)
        const allow = options.find((o) => o.kind === 'allow_once' && string(o.optionId))
        const name = opencodeToolName(tool)
        if (name.startsWith('mcp__jetty__'))
          for (const event of session.translator.translate({
            ...tool,
            title: name,
            sessionUpdate: 'tool_call_update',
          }))
            yield* session.emit(event)
        if (
          allow &&
          [...SELF_TOOLS, ...THREAD_TOOLS, 'add_project'].some(
            (tool) => name === `mcp__jetty__${tool}`
          )
        ) {
          yield* connection.respond(id, acpPermissionOutcome(options, 'allow'))
          return
        }
        if (!allow) {
          yield* connection.respond(id, { outcome: { outcome: 'cancelled' } })
          return
        }
        const itemId = newId()
        const input = {
          ...session.translator.toolInput(string(tool.toolCallId)),
          ...opencodeToolInput(tool),
        }
        const changes = Array.isArray(input.changes)
          ? input.changes.map((change) => ({
              path: string(object(change).path),
              before: string(object(change).before),
              after: string(object(change).after),
            }))
          : approvalChanges(name, input)
        const toolCallId =
          string(tool.toolCallId) && session.translator.toolItemId(string(tool.toolCallId))
        session.pending.set(itemId, { id, options })
        yield* session.emit({
          type: 'item.started',
          item: {
            id: itemId,
            turnId: session.input.turnId,
            createdAt: Date.now(),
            kind: 'approval',
            title: string(tool.title) || 'Run tool',
            toolName: name,
            ...(toolCallId ? { toolCallId } : {}),
            input: changes.length ? approvalInputWithoutChanges(input) : input,
            suggestions: [],
            ...(changes.length ? { changes } : {}),
            ...(options.some((o) => o.kind === 'allow_always' && string(o.optionId))
              ? { always: { scope: 'session', patterns: [] } }
              : {}),
          },
        })
        yield* session.emit({ type: 'session.status', status: 'awaiting_approval' })
      })
    }

    function updateConfig(session: Session, update: Record<string, unknown>) {
      if (update.sessionUpdate === 'config_option_update' && Array.isArray(update.configOptions))
        session.config = { ...session.config, configOptions: update.configOptions }
      if (
        update.sessionUpdate === 'available_commands_update' &&
        Array.isArray(update.availableCommands)
      )
        session.commands = new Set(
          update.availableCommands.map((command) => string(object(command).name))
        )
    }

    function run(session: Session, cwd: string) {
      return Effect.scoped(
        Effect.gen(function* () {
          const binding = options.mcp
            ? yield* options.mcp.open({ threadId: session.input.threadId, provider: 'opencode' })
            : undefined
          const thread = yield* store.requireThread(session.input.threadId)
          const project = yield* store.getProject(thread.projectId)
          const instructions =
            session.bot || binding
              ? yield* instructionsFile(
                  session.bot?.snapshot ??
                    jettyInstructions(
                      yield* store.getAgentBehaviours(),
                      session.input.parentThreadId,
                      {
                        environment: thread.environment,
                        workingPath: cwd,
                        projectPath: project!.path,
                      }
                    ).replace(
                      'use AskUserQuestion and wait for the answer',
                      'ask your question in your final response'
                    )
                )
              : undefined
          // Permissions are fixed at spawn, so startTurn restarts the session when the mode changes.
          const config = {
            ...(instructions ? { instructions: [join(instructions, 'jetty.md')] } : {}),
            permission: {
              ...(session.full ? { '*': 'allow' } : {}),
              ...(session.bot
                ? {
                    todowrite: 'deny',
                    task: 'deny',
                    external_directory: Object.fromEntries(
                      session.bot.allowedPaths.map((path) => [`${path}/**`, 'allow'])
                    ),
                  }
                : {}),
            },
          }
          const { connection, init } = yield* openOpencodeConnection(cwd, {
            ...options,
            env: { ...options.env, ...opencodeConfigEnv(config) },
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
          session.connection = connection
          const resume = yield* store.getProviderSessionId(session.input.threadId, 'opencode')
          if (resume && object(init.agentCapabilities).loadSession !== true)
            return yield* Effect.fail(
              new AgentError('OpenCode does not support loading the saved session')
            )
          const result = yield* connection.request(resume ? 'session/load' : 'session/new', {
            cwd,
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
          if (!sessionId)
            return yield* Effect.fail(new AgentError('OpenCode returned no session id'))
          session.providerThreadId = sessionId
          session.config = result
          yield* store.setProviderSessionId(session.input.threadId, 'opencode', sessionId)
          yield* configure(session, session.input)
          // ACP load replays history. Jetty's ledger already owns it, but retain session metadata.
          const drain = Effect.gen(function* () {
            for (const message of yield* Queue.takeAll(connection.messages)) {
              if (message.params.sessionId === sessionId)
                updateConfig(session, object(message.params.update))
              if (message.id !== undefined)
                yield* connection.reject(message.id, 'Session is loading')
            }
          })
          yield* drain
          yield* session.emit({ type: 'turn.started', turnId: session.input.turnId })
          yield* prompt(session, session.input.text, session.input.images)
          session.accepting = !session.input.compact
          while (true) {
            const message = yield* Queue.take(connection.messages)
            yield* session.publication.withPermit(
              Effect.gen(function* () {
                if (message.id !== undefined) {
                  yield* handleRequest(session, message)
                  return
                }
                if (message.method === 'session/update' && message.params.sessionId === sessionId) {
                  const update = object(message.params.update)
                  updateConfig(session, update)
                  if (
                    session.steerFolding &&
                    !session.next &&
                    ['agent_message_chunk', 'agent_thought_chunk', 'tool_call'].includes(
                      string(update.sessionUpdate)
                    )
                  ) {
                    session.steerUnread = false
                    session.steerFolding = false
                  }
                  const usage = opencodeContextUsage(update)
                  if (usage) yield* session.emit({ type: 'context.updated', usage })
                  if (session.input.compact && update.sessionUpdate === 'agent_message_chunk')
                    session.compactionOutput += string(object(update.content).text)
                  else if (session.awaitingResult)
                    for (const event of session.translator.translate(update))
                      yield* session.emit(event)
                }
                if (
                  !session.awaitingResult ||
                  message.method !== '$response' ||
                  message.params.requestId !== session.requestId
                )
                  return
                yield* settle(session)
                if (session.next) {
                  const next = session.next
                  session.next = undefined
                  session.translator = createOpencodeTranslator(session.input.turnId)
                  yield* session.emit({ type: 'session.status', status: 'running' })
                  yield* prompt(session, next.text, next.images)
                  return
                }
                const result = object(message.params.result)
                const error =
                  session.reason ||
                  string(object(message.params.error).message) ||
                  (session.input.compact &&
                  /^Failed to run \/compact:/i.test(session.compactionOutput.trim())
                    ? session.compactionOutput.trim()
                    : '') ||
                  (result.stopReason === 'end_turn'
                    ? ''
                    : session.denied && result.stopReason === 'cancelled'
                      ? 'approval_denied'
                      : `OpenCode stopped: ${String(result.stopReason ?? 'missing stop reason')}`)
                session.accepting = false
                yield* finishCompaction(session, error || undefined)
                yield* session.emit(
                  error
                    ? {
                        type: 'turn.failed',
                        turnId: session.input.turnId,
                        error: opencodeError(error).message,
                      }
                    : { type: 'turn.completed', turnId: session.input.turnId }
                )
                session.awaitingResult = false
                session.requestId = undefined
                yield* Deferred.succeed(session.done, undefined)
                yield* armIdle(session)
              })
            )
          }
        })
      ).pipe(Effect.mapError((error) => opencodeError(error.message)))
    }

    function stopOnFailure(session: Session, reason: string) {
      return Effect.gen(function* () {
        session.reason = reason
        session.accepting = false
        if (session.fiber) yield* Fiber.interrupt(session.fiber)
      })
    }

    function cancel(session: Session) {
      return Effect.gen(function* () {
        if (session.connection && session.providerThreadId) {
          for (const pending of session.pending.values())
            yield* session.connection.respond(pending.id, { outcome: { outcome: 'cancelled' } })
          yield* session.connection.notify('session/cancel', {
            sessionId: session.providerThreadId,
          })
        }
        const requestId = session.requestId
        yield* Effect.sleep(graceMs).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              session.awaitingResult && session.requestId === requestId
                ? stopOnFailure(
                    session,
                    session.reason ?? 'OpenCode did not acknowledge cancellation'
                  )
                : Effect.void
            )
          ),
          Effect.forkIn(owner)
        )
      })
    }

    return {
      supportsCompaction: true,
      startTurn(input, emit) {
        return Effect.gen(function* () {
          const thread = yield* store.requireThread(input.threadId)
          const project = yield* store.getProject(thread.projectId)
          if (!project) return yield* Effect.fail(new AgentError('Thread project not found'))
          const bot = yield* prepareBot(store, input.threadId, input.cwd ?? project.path)
          let existing = sessions.get(input.threadId)
          if (
            existing &&
            (existing.bot?.hash !== bot?.hash ||
              existing.full !== (input.permissionMode === 'full_access'))
          ) {
            if (existing.awaitingResult)
              return yield* Effect.fail(new AgentError('Turn already active'))
            existing.expired = true
            if (existing.idle) yield* Fiber.interrupt(existing.idle)
            if (existing.fiber) yield* Fiber.interrupt(existing.fiber)
            existing = undefined
          }
          if (existing) {
            if (existing.awaitingResult)
              return yield* Effect.fail(new AgentError('Turn already active'))
            yield* existing.publication
              .withPermit(
                Effect.gen(function* () {
                  if (existing!.awaitingResult)
                    return yield* Effect.fail(new AgentError('Turn already active'))
                  if (existing!.idle) yield* Fiber.interrupt(existing!.idle)
                  existing!.idle = null
                  if (existing!.expired) return
                  yield* configure(existing!, input).pipe(Effect.onError(() => armIdle(existing!)))
                  existing!.input = input
                  existing!.emit = emit
                  existing!.translator = createOpencodeTranslator(input.turnId)
                  existing!.done = yield* Deferred.make<void, AgentError>()
                  existing!.reason = null
                  existing!.stopped = false
                  existing!.awaitingResult = true
                  existing!.accepting = !input.compact
                  yield* emit({ type: 'turn.started', turnId: input.turnId })
                  yield* prompt(existing!, input.text, input.images)
                })
              )
              .pipe(
                Effect.onError((cause) => stopOnFailure(existing!, String(Cause.squash(cause))))
              )
            if (existing.expired) {
              if (existing.fiber) yield* Fiber.interrupt(existing.fiber)
              existing = undefined
            } else return { await: Deferred.await(existing.done) }
          }
          const session: Session = {
            input,
            cwd: input.cwd ?? project.path,
            full: input.permissionMode === 'full_access',
            steerUnread: false,
            steerFolding: false,
            bot,
            emit,
            translator: createOpencodeTranslator(input.turnId),
            done: yield* Deferred.make<void, AgentError>(),
            idle: null,
            expired: false,
            accepting: false,
            awaitingResult: true,
            reason: null,
            stopped: false,
            denied: false,
            pending: new Map(),
            publication: yield* Semaphore.make(1),
            config: {},
            commands: new Set(),
            compactionOutput: '',
          }
          sessions.set(input.threadId, session)
          function cleanup(reason: string, failed = false) {
            return session.publication
              .withPermit(
                Effect.gen(function* () {
                  session.accepting = false
                  yield* settle(session).pipe(Effect.ignore)
                  if (session.awaitingResult) {
                    yield* finishCompaction(session, reason).pipe(Effect.ignore)
                    yield* session
                      .emit({ type: 'turn.failed', turnId: session.input.turnId, error: reason })
                      .pipe(Effect.ignore)
                    session.awaitingResult = false
                  }
                  if (failed) yield* Deferred.fail(session.done, new AgentError(reason))
                  else yield* Deferred.succeed(session.done, undefined)
                })
              )
              .pipe(Effect.ignore)
          }
          session.fiber = yield* run(session, input.cwd ?? project.path).pipe(
            Effect.onInterrupt(() => cleanup(session.reason ?? 'server shutdown')),
            Effect.onError((cause) => {
              const error = Cause.squash(cause)
              return cleanup(error instanceof Error ? error.message : String(error), true)
            }),
            Effect.ensuring(
              Effect.sync(() => {
                if (sessions.get(input.threadId) === session) sessions.delete(input.threadId)
              })
            ),
            Effect.onExit((exit) => Deferred.done(session.done, exit)),
            Effect.forkIn(owner)
          )
          return { await: Deferred.await(session.done) }
        }).pipe(
          Effect.mapError((error) =>
            error instanceof AgentError ? error : new AgentError(error.message)
          ),
          admission.withPermit
        )
      },
      hasPendingUserMessage(threadId) {
        return sessions.get(threadId)?.steerUnread ?? false
      },
      setBotAllowRules() {
        return Effect.void
      },
      steer(threadId, text, images?: AgentImage[], beforeAccept = Effect.void, fromUser = false) {
        return Effect.suspend(() => {
          const session = sessions.get(threadId)
          if (!session) return Effect.succeed(false)
          return session.publication
            .withPermit(
              Effect.gen(function* () {
                if (!session.accepting || session.next || !session.connection) return false
                yield* beforeAccept
                session.next = { text, images }
                if (fromUser) session.steerUnread = true
                yield* cancel(session)
                return true
              })
            )
            .pipe(
              Effect.uninterruptible,
              Effect.onError((cause) => stopOnFailure(session, String(Cause.squash(cause))))
            )
        })
      },
      interrupt(threadId, reason = 'interrupted') {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session || !session.awaitingResult) return
          yield* session.publication.withPermit(
            Effect.gen(function* () {
              session.reason = reason
              session.stopped = true
              session.accepting = false
              session.next = undefined
              yield* cancel(session)
              if (!session.connection && session.fiber)
                yield* Fiber.interrupt(session.fiber).pipe(Effect.forkIn(owner))
            })
          )
        })
      },
      respondToApproval(threadId, itemId, decision, message?: string, decidedBy?: ApprovalDecider) {
        return Effect.suspend(() => {
          const session = sessions.get(threadId)
          if (!session) return Effect.succeed(false)
          return session.publication
            .withPermit(
              Effect.gen(function* () {
                const pending = session.pending.get(itemId)
                if (!session.accepting || session.next || !pending || !session.connection)
                  return false
                yield* session.emit(
                  {
                    type: 'item.completed',
                    itemId,
                    patch: {
                      decision,
                      ...(message ? { deniedReason: message } : {}),
                      ...(decidedBy ? { decidedBy } : {}),
                    },
                  },
                  Effect.sync(() => session.pending.delete(itemId))
                )
                session.denied = decision === 'deny'
                yield* session.connection.respond(
                  pending.id,
                  acpPermissionOutcome(pending.options, decision)
                )
                yield* session.emit({
                  type: 'session.status',
                  status: session.pending.size ? 'awaiting_approval' : 'running',
                })
                return true
              })
            )
            .pipe(
              Effect.uninterruptible,
              Effect.onError((cause) => stopOnFailure(session, String(Cause.squash(cause))))
            )
        })
      },
      // OpenCode's question tool is not exposed over ACP.
      respondToQuestion() {
        return Effect.succeed(false)
      },
    } satisfies Agent
  })
}

export function opencodeLayer(store: Store, options: OpencodeOptions = {}) {
  return Layer.effect(AgentService, createOpencodeAdapter(store, options))
}

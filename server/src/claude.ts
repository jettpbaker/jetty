import {
  query,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { type ThreadEvent } from '@jetty/shared/events'
import { type ApprovalDecision, QuestionSpec } from '@jetty/shared/items'
import { newId, type PermissionMode } from '@jetty/shared/wire'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Path,
  Queue,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from 'effect'

import type { Attachments } from './attachments'
import type { Store } from './store'

import {
  AgentError,
  AgentService,
  type Agent,
  type AgentHooks,
  type AgentImage,
  type Emit,
  type TurnInput,
} from './agent'
import {
  createTranslateCtx,
  translate,
  type SdkLikeMessage,
  type TranslateCtx,
} from './claude-translate'
import { createContextPoller, readContextUsage, type ContextPoller } from './context-usage'
import { createJettyMcpServer, SEND_IMAGES_TOOL } from './send-images'
import { SEND_VIDEO_TOOL } from './send-video'
import { readUsage } from './usage'

const AUTO_ALLOWED_TOOLS = new Set([SEND_IMAGES_TOOL, SEND_VIDEO_TOOL])
const DEFAULT_TTL_MS = 10 * 60 * 1000

export type QueryFactory = (input: Parameters<typeof query>[0]) => Query
export type ClaudeOptions = { query?: QueryFactory; ttlMs?: number; interruptGraceMs?: number }

type PendingApproval = {
  result: Deferred.Deferred<PermissionResult>
  input: Record<string, unknown>
}

type WarmSession = {
  threadId: string
  query: Query
  input: Queue.Queue<SDKUserMessage, Cause.Done>
  scope: Scope.Closeable
  spawnKey: string
  activeTurnId: string
  pendingApprovals: Map<string, PendingApproval>
  pendingQuestions: Map<string, PendingApproval>
  idle: Fiber.Fiber<void> | null
  grace: Fiber.Fiber<void> | null
  ctx: TranslateCtx
  emit: Emit
  closed: boolean
  queryClosed: boolean
  awaitingResult: boolean
  accepting: boolean
  failReason: string | null
  done: Deferred.Deferred<void, AgentError>
  contextPoller: ContextPoller
  publication: Semaphore.Semaphore
}

function toSdkPermissionMode(mode: PermissionMode | undefined) {
  return mode === 'full_access' ? 'bypassPermissions' : 'auto'
}

function resolvedModel(input: TurnInput): string {
  return input.model ?? process.env.JETTY_DEFAULT_MODEL ?? 'haiku'
}

function turnOptionsKey(input: TurnInput): string {
  return `${resolvedModel(input)}|${input.effort ?? ''}|${toSdkPermissionMode(input.permissionMode)}`
}

function userMessage(text: string, images?: AgentImage[]): SDKUserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: images?.length
        ? [
            ...images.map((image) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: image.mimeType,
                data: image.base64data,
              },
            })),
            { type: 'text' as const, text },
          ]
        : text,
    },
    parent_tool_use_id: null,
  }
}

export function createClaudeAdapter(
  store: Store,
  attachments: Attachments,
  hooks: AgentHooks = {},
  config: ClaudeOptions = {}
): Effect.Effect<Agent, never, Scope.Scope | Path.Path> {
  return Effect.gen(function* () {
    const owner = yield* Effect.scope
    const path = yield* Path.Path
    const context = yield* Effect.context<never>()
    const run = Effect.runPromiseWith(context)
    const sessions = new Map<string, WarmSession>()
    const ttlMs = config.ttlMs ?? Number(process.env.JETTY_SESSION_TTL_MS ?? DEFAULT_TTL_MS)
    const makeQuery = config.query ?? query
    let usageInFlight = false

    function current(session: WarmSession) {
      return !session.closed && sessions.get(session.threadId) === session
    }

    function publish(session: WarmSession, event: ThreadEvent) {
      return Effect.gen(function* () {
        const grace = yield* session.publication.withPermit(
          Effect.gen(function* () {
            if (!current(session)) return null
            const terminal = event.type === 'turn.completed' || event.type === 'turn.failed'
            if (terminal && !session.awaitingResult) return null
            if (terminal) session.accepting = false
            yield* session.emit(
              terminal && session.failReason
                ? { type: 'turn.failed', turnId: session.activeTurnId, error: session.failReason }
                : event
            )
            if (terminal) {
              session.awaitingResult = false
              yield* Deferred.succeed(session.done, undefined)
              const grace = session.grace
              session.grace = null
              return grace
            }
            return null
          })
        )
        if (grace) yield* Fiber.interrupt(grace)
      })
    }

    function denyPending(session: WarmSession) {
      function deny(
        pending: Map<string, PendingApproval>,
        patch: { decision: ApprovalDecision } | { skipped: true },
        message: string
      ) {
        return Effect.gen(function* () {
          for (const [itemId, { result }] of pending) {
            yield* session
              .emit({ type: 'item.completed', itemId, patch })
              .pipe(Effect.catch((error) => (session.closed ? Effect.void : Effect.fail(error))))
            pending.delete(itemId)
            yield* Deferred.succeed(result, { behavior: 'deny', message })
          }
        })
      }
      return deny(session.pendingApprovals, { decision: 'deny' }, 'Denied by user').pipe(
        Effect.andThen(
          deny(session.pendingQuestions, { skipped: true }, 'The user did not answer the questions')
        )
      )
    }

    function closeResources(
      session: WarmSession,
      reason = 'server shutdown',
      expected?: { turnId: string; awaitingResult: boolean }
    ) {
      return Effect.gen(function* () {
        if (session.closed) return false
        if (
          expected &&
          (!current(session) ||
            session.activeTurnId !== expected.turnId ||
            session.awaitingResult !== expected.awaitingResult)
        )
          return false
        session.closed = true
        session.accepting = false
        yield* Queue.end(session.input)
        yield* Effect.try(() => closeQuery(session)).pipe(Effect.ignore)
        yield* denyPending(session).pipe(Effect.ignore)
        if (session.awaitingResult) {
          session.awaitingResult = false
          yield* session
            .emit({
              type: 'turn.failed',
              turnId: session.activeTurnId,
              error: session.failReason ?? reason,
            })
            .pipe(Effect.ignore)
        }
        yield* Deferred.succeed(session.done, undefined)
        if (sessions.get(session.threadId) === session) sessions.delete(session.threadId)
        return true
      }).pipe(session.publication.withPermit, Effect.uninterruptible)
    }

    function closeQuery(session: WarmSession) {
      if (session.queryClosed) return
      session.queryClosed = true
      session.query.close()
    }

    function closeSession(session: WarmSession, reason?: string) {
      return closeResources(session, reason).pipe(
        Effect.andThen(Scope.close(session.scope, Exit.void))
      )
    }

    function retire(
      session: WarmSession,
      reason: string,
      expected?: { turnId: string; awaitingResult: boolean }
    ) {
      return closeResources(session, reason, expected).pipe(
        Effect.flatMap((closed) =>
          closed ? Effect.forkIn(Scope.close(session.scope, Exit.void), owner) : Effect.void
        ),
        Effect.asVoid
      )
    }

    function requestUsage(session: WarmSession) {
      return Effect.gen(function* () {
        if (usageInFlight || !current(session) || !hooks.onUsage) return
        usageInFlight = true
        yield* Effect.promise(() => readUsage(session.query)).pipe(
          Effect.flatMap((usage) =>
            Effect.sync(() => {
              if (usage && current(session)) hooks.onUsage?.(usage)
            })
          ),
          Effect.ensuring(
            Effect.sync(() => {
              usageInFlight = false
            })
          ),
          Effect.forkIn(session.scope)
        )
      })
    }

    function armIdle(session: WarmSession) {
      return Effect.gen(function* () {
        if (session.idle) yield* Fiber.interrupt(session.idle)
        const turnId = session.activeTurnId
        session.idle = yield* Effect.sleep(ttlMs).pipe(
          Effect.andThen(retire(session, 'idle ttl', { turnId, awaitingResult: false })),
          Effect.forkIn(session.scope)
        )
      })
    }

    function readSession(session: WarmSession) {
      const messages = {
        [Symbol.asyncIterator]() {
          const iterator = session.query[Symbol.asyncIterator]()
          return {
            next: () => iterator.next(),
            return() {
              closeQuery(session)
              return (
                iterator.return?.() ?? Promise.resolve({ done: true as const, value: undefined })
              )
            },
          }
        },
      }
      return Stream.fromAsyncIterable(messages, (error) => new AgentError(String(error))).pipe(
        Stream.runForEach((message) =>
          Effect.gen(function* () {
            if (!current(session)) return
            if (!session.awaitingResult && message.type !== 'system') return
            if (message.type === 'result') {
              yield* session.publication.withPermit(
                Effect.sync(() => {
                  session.accepting = false
                })
              )
            }
            const events = yield* Effect.try({
              try: () => translate(message as SdkLikeMessage, session.ctx),
              catch: (error) => new AgentError(String(error)),
            })
            if (session.ctx.sessionId) {
              yield* store
                .setThreadSessionId(session.threadId, session.ctx.sessionId)
                .pipe(Effect.mapError((error) => new AgentError(error.message)))
              session.ctx.sessionId = null
            }
            for (const event of events) yield* publish(session, event)
            if (message.type === 'result') {
              yield* requestUsage(session)
              yield* session.contextPoller.poll(true)
              yield* armIdle(session)
            } else {
              yield* session.contextPoller.poll(
                message.type === 'system' &&
                  'subtype' in message &&
                  message.subtype === 'compact_boundary'
              )
            }
          })
        ),
        Effect.matchEffect({
          onFailure: (error) => retire(session, error.message),
          onSuccess: () => retire(session, 'stream ended'),
        })
      )
    }

    function requestPermission(
      session: WarmSession,
      toolName: string,
      toolInput: Record<string, unknown>,
      options: Parameters<NonNullable<Options['canUseTool']>>[2]
    ) {
      return Effect.gen(function* () {
        const result = yield* Deferred.make<PermissionResult>()
        yield* session.publication.withPermit(
          Effect.gen(function* () {
            if (!current(session) || !session.accepting) {
              yield* Deferred.succeed(result, {
                behavior: 'deny',
                message: 'Session closed',
              })
              return
            }
            if (AUTO_ALLOWED_TOOLS.has(toolName)) {
              yield* Deferred.succeed(result, {
                behavior: 'allow',
                updatedInput: toolInput,
              })
              return
            }
            const itemId = newId()
            if (toolName === 'AskUserQuestion') {
              const parsed = Schema.decodeUnknownResult(Schema.Array(QuestionSpec))(
                (toolInput as { questions?: unknown }).questions
              )
              if (Result.isFailure(parsed)) {
                yield* Deferred.succeed(result, {
                  behavior: 'deny',
                  message: 'Malformed questions',
                })
                return
              }
              session.pendingQuestions.set(itemId, { result, input: toolInput })
              yield* session.emit({
                type: 'item.started',
                item: {
                  id: itemId,
                  turnId: session.activeTurnId,
                  createdAt: Date.now(),
                  kind: 'question',
                  questions: parsed.success,
                },
              })
            } else {
              session.pendingApprovals.set(itemId, { result, input: toolInput })
              yield* session.emit({
                type: 'item.started',
                item: {
                  id: itemId,
                  turnId: session.activeTurnId,
                  createdAt: Date.now(),
                  kind: 'approval',
                  title: options.title ?? toolName,
                  toolName,
                  input: toolInput,
                  suggestions: options.suggestions ?? [],
                },
              })
            }
            yield* session.emit({ type: 'session.status', status: 'awaiting_approval' })
          }).pipe(
            Effect.onError(() =>
              Effect.sync(() => {
                session.accepting = false
              })
            )
          )
        )
        return yield* Deferred.await(result)
      }).pipe(Effect.onError(() => retire(session, 'Unable to complete tool permission')))
    }

    function resolvePending(
      threadId: string,
      itemId: string,
      pendingOf: (session: WarmSession) => Map<string, PendingApproval>,
      patch: Record<string, unknown>,
      result: (pending: PendingApproval) => PermissionResult
    ) {
      return Effect.suspend(() => {
        const session = sessions.get(threadId)
        if (!session) return Effect.succeed(false)
        return session.publication
          .withPermit(
            Effect.gen(function* () {
              const pending = pendingOf(session).get(itemId)
              if (!current(session) || !session.accepting || !pending) return false
              yield* session.emit({ type: 'item.completed', itemId, patch })
              pendingOf(session).delete(itemId)
              yield* session
                .emit({ type: 'session.status', status: 'running' })
                .pipe(Effect.ensuring(Deferred.succeed(pending.result, result(pending))))
              return true
            })
          )
          .pipe(Effect.uninterruptible)
      })
    }

    function spawnSession(input: TurnInput, emit: Emit, projectPath: string) {
      return Effect.gen(function* () {
        const scope = yield* Scope.fork(owner)
        const queue = yield* Queue.make<SDKUserMessage, Cause.Done>()
        const done = yield* Deferred.make<void, AgentError>()
        let session: WarmSession | undefined

        const canUseTool: NonNullable<Options['canUseTool']> = (toolName, toolInput, options) =>
          run(
            Effect.gen(function* () {
              if (!session || !current(session))
                return yield* Effect.fail(new AgentError('Session closed'))
              const fiber = yield* Effect.forkIn(
                requestPermission(session, toolName, toolInput, options),
                scope
              )
              return yield* Fiber.join(fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber)))
            }),
            { signal: options.signal }
          ).catch(() => ({ behavior: 'deny' as const, message: 'Session closed' }))

        const jetty = yield* createJettyMcpServer({
          attachments,
          projectPath,
          turnId: () => session?.activeTurnId ?? input.turnId,
          emit: (event, turnId, onCommit) =>
            Effect.suspend(() => {
              const target = session
              if (!target) return Effect.fail(new AgentError('Session closed'))
              return target.publication.withPermit(
                Effect.gen(function* () {
                  if (!current(target) || !target.accepting || target.activeTurnId !== turnId) {
                    return yield* Effect.fail(new AgentError('Turn is no longer active'))
                  }
                  yield* target.emit(event, onCommit)
                })
              )
            }),
        }).pipe(Effect.provideService(Path.Path, path), Effect.provideService(Scope.Scope, scope))
        const permissionMode = toSdkPermissionMode(input.permissionMode)
        const resume = yield* store
          .getThreadSessionId(input.threadId)
          .pipe(Effect.mapError((error) => new AgentError(error.message)))
        const q = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              makeQuery({
                prompt: {
                  async *[Symbol.asyncIterator]() {
                    while (true) {
                      const next = await run(Queue.take(queue).pipe(Effect.option))
                      if (next._tag === 'None') return
                      yield next.value
                    }
                  },
                },
                options: {
                  cwd: projectPath,
                  systemPrompt: { type: 'preset', preset: 'claude_code' },
                  settingSources: ['user', 'project', 'local'],
                  model: resolvedModel(input),
                  effort: input.effort,
                  permissionMode,
                  disallowedTools: ['EnterPlanMode', 'ExitPlanMode'],
                  allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
                  includePartialMessages: true,
                  canUseTool,
                  resume: resume ?? undefined,
                  mcpServers: { jetty },
                  allowedTools: [SEND_IMAGES_TOOL, SEND_VIDEO_TOOL],
                },
              }),
            catch: (error) => new AgentError(String(error)),
          }),
          (q) => (session ? closeResources(session) : Effect.sync(() => q.close()))
        ).pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void))
        )
        const poller = yield* createContextPoller({
          read: Effect.promise(() => readContextUsage(q)),
          emit: (usage) =>
            Effect.suspend(() =>
              session && current(session)
                ? publish(session, { type: 'context.updated', usage }).pipe(Effect.ignore)
                : Effect.void
            ),
        }).pipe(Scope.provide(scope))
        session = {
          threadId: input.threadId,
          query: q,
          input: queue,
          scope,
          spawnKey: turnOptionsKey(input),
          activeTurnId: input.turnId,
          pendingApprovals: new Map(),
          pendingQuestions: new Map(),
          idle: null,
          grace: null,
          ctx: createTranslateCtx(input.turnId),
          emit,
          closed: false,
          queryClosed: false,
          awaitingResult: false,
          accepting: false,
          failReason: null,
          done,
          contextPoller: poller,
          publication: yield* Semaphore.make(1),
        }
        const created = session
        sessions.set(input.threadId, created)
        return created
      })
    }

    return {
      startTurn(input, emit) {
        return Effect.gen(function* () {
          const projectPath = yield* Effect.gen(function* () {
            const thread = yield* store.getThread(input.threadId)
            const project = thread && (yield* store.getProject(thread.projectId))
            if (!project)
              return yield* Effect.fail(
                new AgentError(`Thread ${input.threadId} project not found`)
              )
            return project.path
          }).pipe(
            Effect.mapError((error) =>
              error instanceof AgentError ? error : new AgentError(error.message)
            )
          )
          let session = sessions.get(input.threadId)
          if (session) {
            const idle = session.idle
            session.idle = null
            if (idle) yield* Fiber.interrupt(idle)
            yield* session.publication.withPermit(Effect.void)
          }
          if (session && !current(session)) session = undefined
          if (session?.awaitingResult)
            return yield* Effect.fail(new AgentError('Turn already active'))
          if (session && session.spawnKey !== turnOptionsKey(input)) {
            yield* closeSession(session, 'options changed')
            session = undefined
          }
          const fresh = !session
          session ??= yield* spawnSession(input, emit, projectPath)
          const started = session
          return yield* Effect.gen(function* () {
            started.activeTurnId = input.turnId
            started.ctx = createTranslateCtx(input.turnId)
            started.emit = emit
            started.awaitingResult = true
            started.accepting = true
            started.failReason = null
            started.done = yield* Deferred.make<void, AgentError>()
            yield* publish(started, { type: 'turn.started', turnId: input.turnId })
            yield* Queue.offer(started.input, userMessage(input.text, input.images))
            if (fresh) {
              yield* Effect.forkIn(readSession(started), started.scope)
              yield* requestUsage(started)
              yield* started.contextPoller.poll()
              yield* Scope.addFinalizer(started.scope, closeResources(started))
            }
            return { await: Deferred.await(started.done) }
          }).pipe(Effect.onError(() => closeSession(started, 'Unable to start turn')))
        })
      },
      steer(threadId, text, images, beforeAccept = Effect.void) {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session || !current(session) || !session.accepting) return false
          return yield* session.publication.withPermit(
            Effect.gen(function* () {
              if (!current(session) || !session.accepting) return false
              yield* beforeAccept
              return yield* Queue.offer(session.input, userMessage(text, images))
            }).pipe(Effect.uninterruptible)
          )
        })
      },
      interrupt(threadId, reason = 'interrupted') {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session) return
          const turnId = yield* session.publication
            .withPermit(
              Effect.gen(function* () {
                if (!current(session) || !session.awaitingResult) return null
                session.failReason = reason
                session.accepting = false
                yield* denyPending(session)
                return session.activeTurnId
              })
            )
            .pipe(Effect.onError(() => retire(session, reason)))
          if (turnId === null) return
          if (!current(session) || !session.awaitingResult || session.activeTurnId !== turnId)
            return
          yield* Effect.tryPromise(() => session.query.interrupt()).pipe(
            Effect.ignore,
            Effect.forkIn(session.scope)
          )
          if (session.grace) yield* Fiber.interrupt(session.grace)
          session.grace = yield* Effect.sleep(config.interruptGraceMs ?? 2000).pipe(
            Effect.andThen(retire(session, reason, { turnId, awaitingResult: true })),
            Effect.forkIn(session.scope)
          )
        })
      },
      respondToApproval(threadId, itemId, decision, message, updatedPermissions) {
        const reason = message?.trim() || undefined
        return resolvePending(
          threadId,
          itemId,
          (session) => session.pendingApprovals,
          { decision, ...(decision === 'deny' && reason ? { deniedReason: reason } : {}) },
          (pending) =>
            decision === 'allow'
              ? {
                  behavior: 'allow',
                  updatedInput: pending.input,
                  updatedPermissions: updatedPermissions as PermissionUpdate[] | undefined,
                }
              : { behavior: 'deny', message: reason ?? 'Denied by user' }
        )
      },
      respondToQuestion(threadId, itemId, answers) {
        return resolvePending(
          threadId,
          itemId,
          (session) => session.pendingQuestions,
          { answers },
          (pending) => ({ behavior: 'allow', updatedInput: { ...pending.input, answers } })
        )
      },
    } satisfies Agent
  })
}

export function claudeLayer(
  store: Store,
  attachments: Attachments,
  hooks: AgentHooks = {},
  options: ClaudeOptions = {}
) {
  return Layer.effect(AgentService, createClaudeAdapter(store, attachments, hooks, options))
}

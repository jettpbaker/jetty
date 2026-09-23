import {
  query,
  type EffortLevel,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { type ThreadEvent } from '@jetty/shared/events'
import { type ApprovalDecision, QuestionSpec } from '@jetty/shared/items'
import { newId } from '@jetty/shared/wire'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from 'effect'

import type { McpSessions } from './mcp-sessions'
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
import { claudeBin } from './claude-bin'
import {
  createTranslateCtx,
  subagentOf,
  translate,
  type SdkLikeMessage,
  type TranslateCtx,
} from './claude-translate'
import { createContextPoller, readContextUsage, type ContextPoller } from './context-usage'
import { SEND_IMAGES_TOOL } from './send-images'
import { SEND_VIDEO_TOOL } from './send-video'
import { readUsage } from './usage'

const AUTO_ALLOWED_TOOLS = new Set([
  SEND_IMAGES_TOOL,
  SEND_VIDEO_TOOL,
  'mcp__jetty__list_threads',
  'mcp__jetty__read_thread',
])
const DEFAULT_TTL_MS = 10 * 60 * 1000

export type QueryFactory = (input: Parameters<typeof query>[0]) => Query
export type ClaudeOptions = {
  mcp?: McpSessions
  query?: QueryFactory
  ttlMs?: number
  interruptGraceMs?: number
  supportsAutoMode?: (model: string) => boolean
}

type PendingApproval = {
  result: Deferred.Deferred<PermissionResult>
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
}

const alwaysScopes = {
  session: 'session',
  cliArg: 'session',
  localSettings: 'project',
  projectSettings: 'project',
  userSettings: 'user',
} as const

// What "Allow always" would add, from Claude's permission suggestions.
function alwaysFrom(suggestions: PermissionUpdate[] | undefined) {
  const first = suggestions?.[0]
  if (!first) return {}
  const patterns = suggestions.flatMap((suggestion) =>
    'rules' in suggestion
      ? suggestion.rules.map((rule) => rule.ruleContent ?? rule.toolName)
      : 'directories' in suggestion
        ? suggestion.directories
        : [suggestion.mode]
  )
  return { always: { scope: alwaysScopes[first.destination], patterns } }
}

type SessionOptions = {
  model: string | undefined
  effort: EffortLevel | undefined
  permissionMode: PermissionMode
}

type WarmSession = {
  threadId: string
  query: Query
  input: Queue.Queue<SDKUserMessage, Cause.Done>
  scope: Scope.Closeable
  options: SessionOptions
  activeTurnId: string
  pendingApprovals: Map<string, PendingApproval>
  pendingQuestions: Map<string, PendingApproval>
  idle: Fiber.Fiber<void> | null
  grace: Fiber.Fiber<void> | null
  ctx: TranslateCtx
  runningAgents: Set<string>
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
            ...(text ? [{ type: 'text' as const, text }] : []),
          ]
        : text,
    },
    parent_tool_use_id: null,
  }
}

// A tool the SDK reports as failed after Stop was cut off, not broken: leaving its status
// unsettled lets the client show it as stopped. Subagents settle with their own status.
function withoutToolFailure(event: ThreadEvent, agents: ReadonlySet<string>): ThreadEvent {
  if (event.type !== 'item.completed' || event.patch?.status !== 'failed') return event
  if (agents.has(event.itemId)) return event
  const { status: _, ...patch } = event.patch
  return { ...event, patch }
}

function trackAgents(running: Set<string>, event: ThreadEvent) {
  if (event.type === 'item.started' && event.item.kind === 'subagent') running.add(event.item.id)
  if (event.type === 'item.completed') running.delete(event.itemId)
}

export function createClaudeAdapter(
  store: Store,
  hooks: AgentHooks = {},
  config: ClaudeOptions = {}
): Effect.Effect<Agent, never, Scope.Scope> {
  return Effect.gen(function* () {
    const owner = yield* Effect.scope
    const context = yield* Effect.context<never>()
    const run = Effect.runPromiseWith(context)
    const sessions = new Map<string, WarmSession>()
    const ttlMs = config.ttlMs ?? Number(process.env.JETTY_SESSION_TTL_MS ?? DEFAULT_TTL_MS)
    const makeQuery = config.query ?? query
    const supportsAutoMode = config.supportsAutoMode ?? (() => true)
    let usageInFlight = false

    function toSdkPermissionMode(input: TurnInput): PermissionMode {
      if (input.model && !supportsAutoMode(input.model)) return 'default'
      return input.permissionMode === 'full_access' ? 'bypassPermissions' : 'auto'
    }

    function sessionOptions(input: TurnInput): SessionOptions {
      return {
        model: input.model,
        effort: input.effort,
        permissionMode: toSdkPermissionMode(input),
      }
    }

    // Model first: auto mode is only valid once the model supports it.
    function applyOptions(session: WarmSession, next: SessionOptions) {
      const { query, options } = session
      return Effect.tryPromise({
        try: async () => {
          if (next.model !== options.model) await query.setModel(next.model)
          if (next.effort !== options.effort)
            await query.applyFlagSettings({ effortLevel: next.effort ?? null })
          if (next.permissionMode !== options.permissionMode)
            await query.setPermissionMode(next.permissionMode)
        },
        catch: (error) => new AgentError(String(error)),
      }).pipe(
        Effect.andThen(
          Effect.sync(() => {
            session.options = next
          })
        )
      )
    }

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
              !session.failReason
                ? event
                : terminal
                  ? { type: 'turn.failed', turnId: session.activeTurnId, error: session.failReason }
                  : withoutToolFailure(event, session.runningAgents)
            )
            trackAgents(session.runningAgents, event)
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
        for (const itemId of session.runningAgents)
          yield* session
            .emit({ type: 'item.completed', itemId, patch: { status: 'stopped' } })
            .pipe(Effect.ignore)
        session.runningAgents.clear()
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
            if (config.mcp && message.type === 'system' && message.subtype === 'init') {
              const jetty = message.mcp_servers.find((server) => server.name === 'jetty')
              if (jetty?.status !== 'connected')
                yield* Effect.logWarning(
                  'Jetty MCP failed to connect; orchestration tools unavailable'
                )
            }
            // Background subagents keep working after the turn that spawned them ends.
            const fromSubagent = 'parent_tool_use_id' in message && message.parent_tool_use_id
            if (!session.awaitingResult && message.type !== 'system' && !fromSubagent) return
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
            // Background subagents outlive their turn; the session stays warm until they settle.
            if (!session.awaitingResult && session.runningAgents.size === 0 && !session.idle)
              yield* armIdle(session)
            if (message.type === 'result') {
              yield* requestUsage(session)
              yield* session.contextPoller.poll(true)
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
            const agentId = subagentOf(session.ctx, options.agentID)
            const base = {
              id: itemId,
              turnId: session.activeTurnId,
              createdAt: Date.now(),
              ...(agentId ? { agentId } : {}),
            }
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
                  ...base,
                  kind: 'question',
                  questions: parsed.success,
                },
              })
            } else {
              session.pendingApprovals.set(itemId, {
                result,
                input: toolInput,
                suggestions: options.suggestions,
              })
              yield* session.emit({
                type: 'item.started',
                item: {
                  ...base,
                  kind: 'approval',
                  title: options.title ?? toolName,
                  toolName,
                  input: toolInput,
                  suggestions: options.suggestions ?? [],
                  ...alwaysFrom(options.suggestions),
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
              const waiting = session.pendingApprovals.size + session.pendingQuestions.size > 0
              yield* session
                .emit({ type: 'session.status', status: waiting ? 'awaiting_approval' : 'running' })
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

        const binding = config.mcp
          ? yield* config.mcp
              .open({ threadId: input.threadId, provider: 'claude' })
              .pipe(Scope.provide(scope))
          : undefined
        const options = sessionOptions(input)
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
                  pathToClaudeCodeExecutable: claudeBin,
                  systemPrompt: { type: 'preset', preset: 'claude_code' },
                  settingSources: ['user', 'project', 'local'],
                  model: options.model,
                  effort: options.effort,
                  permissionMode: options.permissionMode,
                  disallowedTools: ['EnterPlanMode', 'ExitPlanMode'],
                  // Only permits a later live switch into bypassPermissions.
                  allowDangerouslySkipPermissions: true,
                  includePartialMessages: true,
                  forwardSubagentText: true,
                  canUseTool,
                  hooks: {
                    PreToolUse: [
                      {
                        matcher: '^mcp__jetty__(create_thread|send_message)$',
                        hooks: [
                          async () =>
                            session && session.options.permissionMode !== 'default'
                              ? {
                                  hookSpecificOutput: {
                                    hookEventName: 'PreToolUse',
                                    permissionDecision: 'allow',
                                  },
                                }
                              : {},
                        ],
                      },
                    ],
                  },
                  resume: resume ?? undefined,
                  mcpServers: binding
                    ? {
                        jetty: {
                          type: 'http',
                          url: binding.url,
                          headers: { Authorization: 'Bearer ${JETTY_MCP_TOKEN}' },
                        },
                      }
                    : {},
                  env: binding ? { ...process.env, JETTY_MCP_TOKEN: binding.token } : undefined,
                  allowedTools: [...AUTO_ALLOWED_TOOLS],
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
          options,
          activeTurnId: input.turnId,
          pendingApprovals: new Map(),
          pendingQuestions: new Map(),
          idle: null,
          grace: null,
          ctx: createTranslateCtx(input.turnId),
          runningAgents: new Set(),
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
          if (session) {
            const applied = yield* applyOptions(session, sessionOptions(input)).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false)
            )
            if (!applied || !current(session)) {
              yield* closeSession(session, 'options changed')
              session = undefined
            }
          }
          const fresh = !session
          session ??= yield* spawnSession(input, emit, projectPath)
          const started = session
          return yield* Effect.gen(function* () {
            started.activeTurnId = input.turnId
            started.ctx = createTranslateCtx(input.turnId, started.ctx)
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
      respondToApproval(threadId, itemId, decision, message) {
        const reason = message?.trim() || undefined
        return resolvePending(
          threadId,
          itemId,
          (session) => session.pendingApprovals,
          { decision, ...(decision === 'deny' && reason ? { deniedReason: reason } : {}) },
          (pending) =>
            decision !== 'deny'
              ? {
                  behavior: 'allow',
                  updatedInput: pending.input,
                  ...(decision === 'always' ? { updatedPermissions: pending.suggestions } : {}),
                }
              : { behavior: 'deny', message: reason ?? 'Denied by user' }
        )
      },
      respondToQuestion(threadId, itemId, answers) {
        return resolvePending(
          threadId,
          itemId,
          (session) => session.pendingQuestions,
          answers ? { answers } : { dismissed: true },
          (pending) =>
            answers
              ? { behavior: 'allow', updatedInput: { ...pending.input, answers } }
              : { behavior: 'deny', message: 'The user dismissed the questions' }
        )
      },
    } satisfies Agent
  })
}

export function claudeLayer(store: Store, hooks: AgentHooks = {}, options: ClaudeOptions = {}) {
  return Layer.effect(AgentService, createClaudeAdapter(store, hooks, options))
}

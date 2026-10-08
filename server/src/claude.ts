import {
  query,
  getSessionMessages,
  type McpSdkServerConfigWithInstance,
  type EffortLevel,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { type ThreadEvent } from '@jetty/shared/events'
import { QuestionSpec } from '@jetty/shared/items'
import { newId, type Bot, type Project } from '@jetty/shared/wire'
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
import { join } from 'node:path'

import type { Store } from './store'

import {
  AgentError,
  AgentService,
  compactFailureReason,
  couldntCompact,
  type Agent,
  type AgentHooks,
  type AgentImage,
  type Emit,
  type TurnInput,
} from './agent'
import { approvalChanges, approvalInputWithoutChanges } from './approval-changes'
import { botApproval, botAutoMode, type BotPlace } from './bot-approval'
import { botInstructions } from './bot-home'
import { createBackgroundTasks, type BackgroundTasks } from './claude-background'
import { claudeBin } from './claude-bin'
import {
  createTranslateCtx,
  subagentOf,
  toolCallItemId,
  translate,
  type SdkLikeMessage,
  type TranslateCtx,
} from './claude-translate'
import { createContextPoller, readContextUsage, type ContextPoller } from './context-usage'
import { deniedApprovalNote, jettyInstructions, type ThreadWorkspace } from './jetty-instructions'
import { SELF_TOOLS } from './jetty-tools'
import { readClaudeUsageIdentity } from './provider-usage'
import { readUsage } from './usage'

// The rest of Jetty's tools go through Claude's own reviewer: the auto-mode classifier judges them.
const AUTO_ALLOWED_TOOLS = new Set(SELF_TOOLS.map((name) => `mcp__jetty__${name}`))
const DEFAULT_TTL_MS = 10 * 60 * 1000

export type QueryFactory = (input: Parameters<typeof query>[0]) => Query
export type ClaudeOptions = {
  mcp?: (identity: {
    threadId: string
    provider: 'claude'
  }) => Promise<McpSdkServerConfigWithInstance>
  query?: QueryFactory
  ttlMs?: number
  interruptGraceMs?: number
  supportsAutoMode?: (model: string) => boolean
}

type PendingApproval = {
  result: Deferred.Deferred<PermissionResult>
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  // what a bot's Allow always saves
  rule?: { text: string; source: string }
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
  bot: boolean
  places: readonly BotPlace[]
  instructionsHash: string | undefined
  query: Query
  usageIdentity: string | undefined
  input: Queue.Queue<SDKUserMessage, Cause.Done>
  // Jett steered in a message the model hasn't read. Claude Code folds it into the request it
  // builds after the next tool results, so the response after those is the first to have read it.
  steerUnread: boolean
  steerFolding: boolean
  scope: Scope.Closeable
  options: SessionOptions
  activeTurnId: string
  pendingApprovals: Map<string, PendingApproval>
  pendingQuestions: Map<string, PendingApproval>
  idle: Fiber.Fiber<void> | null
  grace: Fiber.Fiber<void> | null
  ctx: TranslateCtx
  runningAgents: Set<string>
  runningWorkflows: Set<string>
  stoppedWorkflows: Set<string>
  backgroundTasks: BackgroundTasks
  emit: Emit
  closed: boolean
  queryClosed: boolean
  awaitingResult: boolean
  wakePending: boolean
  // the current turn is Jetty's /compact
  compact: boolean
  compactFailureNoted: boolean
  compactSucceeded: boolean
  // Resumed at the last entry before a /compact that didn't finish, which it leaves behind.
  rewound: boolean
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

    function toSdkPermissionMode(input: TurnInput, bot: boolean): PermissionMode {
      if (bot && input.permissionMode === 'full_access') return 'bypassPermissions'
      if (input.model && !supportsAutoMode(input.model)) return 'default'
      return input.permissionMode === 'full_access' ? 'bypassPermissions' : 'auto'
    }

    function sessionOptions(input: TurnInput, bot = false): SessionOptions {
      return {
        model: input.model,
        effort: input.effort,
        permissionMode: toSdkPermissionMode(input, bot),
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

    function noteManualCompact(session: WarmSession, failure: string) {
      return Effect.gen(function* () {
        if (!session.compact || session.compactFailureNoted) return
        const detail = compactFailureReason(session.failReason === 'interrupted', failure)
        if (!detail) return
        session.compactFailureNoted = true
        yield* session.emit(couldntCompact(session.activeTurnId, detail))
      })
    }

    function publish(session: WarmSession, event: ThreadEvent) {
      return Effect.gen(function* () {
        const grace = yield* session.publication.withPermit(
          Effect.gen(function* () {
            if (!current(session)) return null
            const terminal = event.type === 'turn.completed' || event.type === 'turn.failed'
            if (terminal && !session.awaitingResult) return null
            if (terminal) {
              session.accepting = false
              session.steerUnread = false
              session.steerFolding = false
            }
            const outgoing = !session.failReason
              ? event
              : terminal
                ? ({
                    type: 'turn.failed',
                    turnId: session.activeTurnId,
                    error: session.failReason,
                  } satisfies ThreadEvent)
                : withoutToolFailure(event, session.runningAgents)
            if (outgoing.type === 'turn.failed') yield* noteManualCompact(session, outgoing.error)
            yield* session.emit(outgoing)
            trackAgents(session.runningAgents, event)
            if (terminal) {
              session.awaitingResult = false
              if (!session.compact || session.compactSucceeded)
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
        patch: { withdrawn: true } | { skipped: true },
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
      return deny(
        session.pendingApprovals,
        { withdrawn: true },
        'Cancelled: the turn ended before the user answered.'
      ).pipe(
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
        for (const itemId of session.runningWorkflows)
          yield* session
            .emit({
              type: 'item.completed',
              itemId,
              patch: { status: 'stopped', stopReason: 'crash' },
            })
            .pipe(Effect.ignore)
        session.runningWorkflows.clear()
        // Shutdown leaves the persisted "still running" flag. The next boot says the work stopped.
        if (session.backgroundTasks.tasks().length) {
          session.backgroundTasks.clear()
          if (reason !== 'server shutdown') yield* publishBackgroundTasks(session)
        }
        if (session.awaitingResult) {
          session.awaitingResult = false
          const error = session.failReason ?? reason
          yield* noteManualCompact(session, error).pipe(Effect.ignore)
          yield* session
            .emit({
              type: 'turn.failed',
              turnId: session.activeTurnId,
              error,
            })
            .pipe(Effect.ignore)
        }
        if (sessions.get(session.threadId) === session) sessions.delete(session.threadId)
        yield* Deferred.succeed(session.done, undefined)
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
        yield* Effect.promise(() => readUsage(session.query, session.usageIdentity)).pipe(
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
        if (
          session.awaitingResult ||
          session.runningAgents.size ||
          session.runningWorkflows.size ||
          session.backgroundTasks.tasks().length ||
          session.idle
        )
          return
        const turnId = session.activeTurnId
        session.idle = yield* Effect.sleep(ttlMs).pipe(
          Effect.andThen(retire(session, 'idle ttl', { turnId, awaitingResult: false })),
          Effect.forkIn(session.scope)
        )
      })
    }

    function publishBackgroundTasks(session: WarmSession) {
      return (
        hooks.onBackgroundTasks?.(session.threadId, session.backgroundTasks.tasks()) ?? Effect.void
      )
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
            if (
              session.steerUnread &&
              message.type === 'user' &&
              !message.parent_tool_use_id &&
              Array.isArray(message.message.content) &&
              message.message.content.some((block) => block.type === 'tool_result')
            )
              session.steerFolding = true
            if (
              session.steerFolding &&
              message.type === 'stream_event' &&
              !message.parent_tool_use_id &&
              message.event.type === 'message_start'
            ) {
              session.steerUnread = false
              session.steerFolding = false
            }
            if (
              message.type === 'system' &&
              message.subtype === 'init' &&
              session.bot &&
              !message.tools.includes('AskUserQuestion')
            )
              return yield* Effect.fail(
                new AgentError('AskUserQuestion is unavailable to this bot')
              )
            // /compact narrates its outcome as assistant text ("Compaction canceled."); a compaction
            // shows only as its seam.
            if (session.compact && 'local_command_source' in message) return
            if (config.mcp && message.type === 'system' && message.subtype === 'init') {
              const jetty = message.mcp_servers.find((server) => server.name === 'jetty')
              if (jetty?.status !== 'connected') {
                yield* Effect.logWarning(
                  'Jetty MCP failed to connect; orchestration tools unavailable'
                )
                yield* publish(session, {
                  type: 'item.started',
                  item: {
                    id: newId(),
                    turnId: session.activeTurnId,
                    createdAt: Date.now(),
                    kind: 'error',
                    message:
                      'Jetty tools failed to connect. Delegation and review tools are unavailable in this thread.',
                  },
                })
              }
            }
            // Background subagents keep working after the turn that spawned them ends.
            const fromSubagent = 'parent_tool_use_id' in message && message.parent_tool_use_id
            const hadBackgroundTasks = session.backgroundTasks.tasks().length > 0
            if (session.backgroundTasks.ingest(message)) {
              if (
                hadBackgroundTasks &&
                !session.backgroundTasks.tasks().length &&
                !session.awaitingResult
              )
                session.wakePending = true
              yield* publishBackgroundTasks(session)
              if (session.backgroundTasks.tasks().length && session.idle) {
                yield* Fiber.interrupt(session.idle)
                session.idle = null
              }
            }
            if (
              !session.awaitingResult &&
              !fromSubagent &&
              (message.type === 'assistant' || message.type === 'stream_event')
            ) {
              const turnId = newId()
              session.activeTurnId = turnId
              session.failReason = null
              session.ctx = createTranslateCtx(turnId, session.ctx)
              session.awaitingResult = true
              session.wakePending = false
              session.accepting = true
              session.done = yield* Deferred.make<void, AgentError>()
              if (session.idle) yield* Fiber.interrupt(session.idle)
              session.idle = null
              yield* publish(session, { type: 'turn.started', turnId })
            }
            if (!session.awaitingResult && message.type !== 'system' && !fromSubagent) return
            if (
              session.compact &&
              message.type === 'system' &&
              message.subtype === 'compact_boundary'
            ) {
              session.compactSucceeded = true
              yield* store
                .setCompactAnchor(session.threadId, undefined)
                .pipe(Effect.mapError((error) => new AgentError(error.message)))
            }
            if (message.type === 'result' && !session.compact && session.rewound) {
              session.rewound = false
              yield* store
                .setCompactAnchor(session.threadId, undefined)
                .pipe(Effect.mapError((error) => new AgentError(error.message)))
            }
            if (message.type === 'result') {
              yield* session.publication.withPermit(
                Effect.sync(() => {
                  session.accepting = false
                })
              )
            }
            const translated = yield* Effect.try({
              try: () => translate(message as SdkLikeMessage, session.ctx),
              catch: (error) => new AgentError(String(error)),
            })
            const events: ThreadEvent[] = []
            for (const original of translated) {
              if (
                !session.awaitingResult &&
                original.type === 'item.completed' &&
                (session.runningAgents.has(original.itemId) ||
                  session.runningWorkflows.has(original.itemId))
              )
                session.wakePending = true
              const event =
                original.type === 'item.completed' && session.stoppedWorkflows.has(original.itemId)
                  ? { ...original, patch: { ...original.patch, stopReason: 'you' } }
                  : original
              events.push(event)
              if (event.type === 'item.started' && event.item.kind === 'workflow')
                session.runningWorkflows.add(event.item.id)
              if (event.type === 'item.completed' && session.runningWorkflows.has(event.itemId))
                session.runningWorkflows.delete(event.itemId)
              if (event.type === 'item.completed' && session.stoppedWorkflows.has(event.itemId)) {
                session.stoppedWorkflows.delete(event.itemId)
              }
            }
            if (session.ctx.sessionId) {
              yield* store
                .setThreadSessionId(session.threadId, session.ctx.sessionId)
                .pipe(Effect.mapError((error) => new AgentError(error.message)))
              session.ctx.sessionId = null
            }
            for (const event of events) yield* publish(session, event)
            const sdk = message as SdkLikeMessage
            if (
              sdk.type === 'system' &&
              sdk.subtype === 'status' &&
              sdk.compact_result === 'failed'
            )
              yield* noteManualCompact(session, sdk.compact_error?.trim() || 'Compaction failed')
            if (message.type === 'result' && session.compact && !session.compactSucceeded) {
              yield* retire(session, 'compaction ended without a boundary')
              return
            }
            // Background subagents outlive their turn; the session stays warm until they settle.
            if (!session.awaitingResult) yield* armIdle(session)
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
      const itemId = newId()
      return Effect.gen(function* () {
        if (
          (toolName === 'Agent' || toolName === 'Task') &&
          toolInput.effort === 'max' &&
          (yield* store.isBot(session.threadId))
        )
          return { behavior: 'deny' as const, message: "max isn't available to bots; use xhigh" }
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
              const changes = approvalChanges(toolName, toolInput)
              const toolCallId = toolCallItemId(session.ctx, options.toolUseID, toolName, agentId)
              const bot =
                session.bot &&
                botApproval(
                  toolName,
                  toolInput,
                  options.suggestions ?? [],
                  session.places,
                  options.matchedAskRule?.toolName === 'Bash'
                    ? options.matchedAskRule.ruleContent
                    : undefined
                )
              session.pendingApprovals.set(itemId, {
                result,
                input: toolInput,
                suggestions: options.suggestions,
                ...(bot && bot.rule ? { rule: { text: bot.rule, source: bot.title } } : {}),
              })
              yield* session.emit({
                type: 'item.started',
                item: {
                  ...base,
                  kind: 'approval',
                  title: bot ? bot.title : (options.title ?? toolName),
                  toolName,
                  ...(toolCallId ? { toolCallId } : {}),
                  input: changes.length ? approvalInputWithoutChanges(toolInput) : toolInput,
                  suggestions: options.suggestions ?? [],
                  ...(changes.length ? { changes } : {}),
                  ...(!bot
                    ? alwaysFrom(options.suggestions)
                    : bot.rule
                      ? { always: { scope: 'user' as const, patterns: [bot.rule] } }
                      : {}),
                },
              })
            }
            yield* session.emit({ type: 'session.status', status: 'awaiting_approval' })
          }).pipe(
            Effect.onError(() =>
              Effect.sync(() => {
                session.accepting = false
              })
            ),
            Effect.uninterruptible
          )
        )
        return yield* Deferred.await(result)
      }).pipe(
        Effect.onInterrupt(() => withdrawPending(session, itemId)),
        Effect.onError((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : retire(session, 'Unable to complete tool permission')
        )
      )
    }

    // Claude withdrew one prompt (its signal aborted); the turn carries on.
    function withdrawPending(session: WarmSession, itemId: string) {
      return session.publication
        .withPermit(
          Effect.gen(function* () {
            const question = session.pendingQuestions.has(itemId)
            const pending = question ? session.pendingQuestions : session.pendingApprovals
            if (!pending.has(itemId)) return
            yield* session.emit({
              type: 'item.completed',
              itemId,
              patch: question ? { skipped: true } : { withdrawn: true },
            })
            pending.delete(itemId)
            if (!session.awaitingResult) return
            const waiting = session.pendingApprovals.size + session.pendingQuestions.size > 0
            yield* session.emit({
              type: 'session.status',
              status: waiting ? 'awaiting_approval' : 'running',
            })
          })
        )
        .pipe(Effect.ignore)
    }

    function resolvePending(
      threadId: string,
      itemId: string,
      pendingOf: (session: WarmSession) => Map<string, PendingApproval>,
      patch: Record<string, unknown>,
      result: (pending: PendingApproval) => PermissionResult,
      beforeResolve?: (
        session: WarmSession,
        pending: PendingApproval
      ) => Effect.Effect<void, AgentError>
    ) {
      return Effect.suspend(() => {
        const session = sessions.get(threadId)
        if (!session) return Effect.succeed(false)
        return session.publication
          .withPermit(
            Effect.gen(function* () {
              const pending = pendingOf(session).get(itemId)
              if (!current(session) || !session.accepting || !pending) return false
              if (beforeResolve) yield* beforeResolve(session, pending)
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

    function spawnSession(
      input: TurnInput,
      emit: Emit,
      projectPath: string,
      bot: Bot | null,
      projects: readonly Project[],
      instructionsHash: string | undefined,
      workspace: ThreadWorkspace
    ) {
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

        const sdkMcp = config.mcp
          ? yield* Effect.tryPromise({
              try: () => config.mcp!({ threadId: input.threadId, provider: 'claude' }),
              catch: (error) => new AgentError(`Jetty tools failed to start: ${String(error)}`),
            })
          : undefined
        const options = sessionOptions(input, Boolean(bot))
        const resume = yield* store
          .getThreadSessionId(input.threadId)
          .pipe(Effect.mapError((error) => new AgentError(error.message)))
        const compactAnchor = yield* store
          .getCompactAnchor(input.threadId)
          .pipe(Effect.mapError((error) => new AgentError(error.message)))
        const behaviours = yield* store
          .getAgentBehaviours()
          .pipe(Effect.mapError((error) => new AgentError(error.message)))
        const instructions =
          !bot && sdkMcp && jettyInstructions(behaviours, input.parentThreadId, workspace)
        const usageIdentity = yield* Effect.promise(() => readClaudeUsageIdentity())
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
                  ...(bot
                    ? {
                        additionalDirectories: [
                          join(projectPath, '..'),
                          ...(bot.projectId
                            ? projects.filter((project) => project.id === bot.projectId)
                            : projects
                          ).map((project) => project.path),
                        ],
                      }
                    : {}),
                  pathToClaudeCodeExecutable: claudeBin,
                  env: {
                    ...process.env,
                    // A resumed session's first turn otherwise starts before claude.ai connectors
                    // reconnect, and the model sees them all removed, then added back.
                    CLAUDE_CODE_MCP_STARTUP_WAIT_MS: '10000',
                    // A bot speaks only through say and react, so Claude Code's nudges to write
                    // something after a quiet turn only make it narrate.
                    ...(bot && {
                      CLAUDE_CODE_SILENT_TURN_REMINDER: '0',
                      CLAUDE_CODE_TERMINAL_MCP_TOOLS: 'mcp__jetty__react,mcp__jetty__say',
                    }),
                  },
                  systemPrompt: {
                    type: 'preset',
                    preset: 'claude_code',
                    ...(instructions ? { append: instructions } : {}),
                  },
                  settingSources: ['user', 'project', 'local'],
                  ...(bot
                    ? {
                        settings: {
                          ...botAutoMode(bot.name, bot.allowRules ?? []),
                          idleCompaction: false,
                        },
                      }
                    : {}),
                  model: options.model,
                  effort: options.effort,
                  permissionMode: options.permissionMode,
                  disallowedTools: [
                    'EnterPlanMode',
                    'ExitPlanMode',
                    ...(input.readOnly ? ['Edit', 'Write', 'NotebookEdit'] : []),
                    ...(input.parentThreadId ? ['AskUserQuestion'] : []),
                    ...(bot
                      ? ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite']
                      : []),
                  ],
                  // Only permits a later live switch into bypassPermissions.
                  allowDangerouslySkipPermissions: true,
                  includePartialMessages: true,
                  forwardSubagentText: true,
                  perTaskStopAffordance: true,
                  canUseTool,
                  ...(bot
                    ? {
                        hooks: {
                          PreToolUse: [
                            {
                              hooks: [
                                async (hookInput) => {
                                  if (hookInput.hook_event_name !== 'PreToolUse') return {}
                                  if (hookInput.tool_name === 'mcp__jetty__add_project')
                                    return {
                                      hookSpecificOutput: {
                                        hookEventName: 'PreToolUse' as const,
                                        permissionDecision: 'ask' as const,
                                        permissionDecisionReason:
                                          'Adding a project needs your approval.',
                                      },
                                    }
                                  if (
                                    !['Agent', 'Task'].includes(hookInput.tool_name) ||
                                    !hookInput.tool_input ||
                                    typeof hookInput.tool_input !== 'object' ||
                                    (hookInput.tool_input as { effort?: unknown }).effort !== 'max'
                                  )
                                    return {}
                                  return {
                                    hookSpecificOutput: {
                                      hookEventName: 'PreToolUse' as const,
                                      permissionDecision: 'deny' as const,
                                      permissionDecisionReason:
                                        "max isn't available to bots; use xhigh",
                                    },
                                  }
                                },
                              ],
                            },
                          ],
                        },
                      }
                    : {}),
                  resume: resume ?? undefined,
                  resumeSessionAt: resume ? compactAnchor : undefined,
                  mcpServers: sdkMcp ? { jetty: sdkMcp } : {},
                  ...(bot
                    ? { tools: { type: 'preset' as const, preset: 'claude_code' as const } }
                    : {}),
                  allowedTools: [
                    ...AUTO_ALLOWED_TOOLS,
                    ...(!bot
                      ? ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite']
                      : []),
                  ],
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
          bot: bot !== null,
          places: bot
            ? [
                { path: projectPath, name: 'its home' },
                ...projects.map((project) => ({ path: project.path, name: project.title })),
              ]
            : [],
          instructionsHash,
          query: q,
          usageIdentity: typeof q.accountInfo === 'function' ? usageIdentity : undefined,
          input: queue,
          steerUnread: false,
          steerFolding: false,
          scope,
          options,
          activeTurnId: input.turnId,
          pendingApprovals: new Map(),
          pendingQuestions: new Map(),
          idle: null,
          grace: null,
          ctx: createTranslateCtx(input.turnId),
          runningAgents: new Set(),
          runningWorkflows: new Set(),
          stoppedWorkflows: new Set(),
          backgroundTasks: createBackgroundTasks(),
          emit,
          closed: false,
          queryClosed: false,
          awaitingResult: false,
          wakePending: false,
          compact: false,
          compactFailureNoted: false,
          compactSucceeded: false,
          rewound: Boolean(resume && compactAnchor),
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
      supportsCompaction: true,
      startTurn(input, emit) {
        return Effect.gen(function* () {
          const workspace = yield* Effect.gen(function* () {
            const thread = yield* store.getThread(input.threadId)
            const project = thread && (yield* store.getProject(thread.projectId))
            if (!project)
              return yield* Effect.fail(
                new AgentError(`Thread ${input.threadId} project not found`)
              )
            return {
              environment: thread!.environment,
              workingPath: input.cwd ?? project.path,
              projectPath: project.path,
            }
          }).pipe(
            Effect.mapError((error) =>
              error instanceof AgentError ? error : new AgentError(error.message)
            )
          )
          const projectPath = workspace.workingPath
          const bot = yield* store
            .getBot(input.threadId)
            .pipe(Effect.mapError((error) => new AgentError(error.message)))
          const projects = bot
            ? yield* store
                .listProjects()
                .pipe(Effect.mapError((error) => new AgentError(error.message)))
            : []
          const instructionsHash = bot
            ? yield* Effect.gen(function* () {
                const behaviours = yield* store
                  .getAgentBehaviours()
                  .pipe(Effect.mapError((error) => new AgentError(error.message)))
                return yield* Effect.tryPromise({
                  try: () => botInstructions(bot, projects, behaviours, projectPath),
                  catch: (error) => new AgentError(String(error)),
                })
              })
            : undefined
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
          if (session && bot && session.instructionsHash !== instructionsHash) {
            yield* closeSession(session, 'instructions changed')
            session = undefined
          }
          if (session) {
            const next = sessionOptions(input, session.bot)
            if (input.compact) next.permissionMode = session.options.permissionMode
            const applied = yield* applyOptions(session, next).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false)
            )
            if (!applied || !current(session)) {
              yield* closeSession(session, 'options changed')
              session = undefined
            }
          }
          if (
            input.compact &&
            !(yield* store
              .getCompactAnchor(input.threadId)
              .pipe(Effect.mapError((error) => new AgentError(error.message))))
          ) {
            const sessionId = yield* store
              .getThreadSessionId(input.threadId)
              .pipe(Effect.mapError((error) => new AgentError(error.message)))
            if (sessionId) {
              const messages = yield* Effect.tryPromise({
                try: () =>
                  getSessionMessages(sessionId, { dir: projectPath, includeSystemMessages: true }),
                catch: (error) => new AgentError(String(error)),
              })
              const anchor = messages.at(-1)?.uuid
              if (anchor)
                yield* store
                  .setCompactAnchor(input.threadId, anchor)
                  .pipe(Effect.mapError((error) => new AgentError(error.message)))
            }
          }
          const fresh = !session
          session ??= yield* spawnSession(
            input,
            emit,
            projectPath,
            bot,
            projects,
            instructionsHash,
            workspace
          )
          const started = session
          return yield* Effect.gen(function* () {
            started.activeTurnId = input.turnId
            started.ctx = createTranslateCtx(input.turnId, started.ctx)
            started.emit = emit
            started.awaitingResult = true
            started.wakePending = false
            started.compact = Boolean(input.compact)
            started.compactFailureNoted = false
            started.compactSucceeded = false
            started.accepting = !input.compact
            started.failReason = null
            started.done = yield* Deferred.make<void, AgentError>()
            if (input.compact && bot) {
              started.ctx.compactionId = newId()
              yield* publish(started, {
                type: 'item.started',
                item: {
                  id: started.ctx.compactionId,
                  turnId: input.turnId,
                  createdAt: Date.now(),
                  kind: 'compaction',
                  status: 'running',
                },
              })
            }
            yield* publish(started, { type: 'turn.started', turnId: input.turnId })
            yield* Queue.offer(
              started.input,
              userMessage(input.compact ? '/compact' : input.text, input.images)
            )
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
      hasPendingUserMessage(threadId) {
        return sessions.get(threadId)?.steerUnread ?? false
      },
      steer(threadId, text, images, beforeAccept = Effect.void, fromUser = false) {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session || !current(session) || !session.accepting) return false
          return yield* session.publication.withPermit(
            Effect.gen(function* () {
              if (!current(session) || !session.accepting) return false
              yield* beforeAccept
              const accepted = yield* Queue.offer(session.input, userMessage(text, images))
              if (accepted && fromUser) {
                session.steerUnread = true
                session.steerFolding = false
              }
              return accepted
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
      stopBackgroundTasks(threadId, taskId) {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session || !current(session)) return
          const tasks = session.backgroundTasks
            .tasks()
            .filter((task) => !taskId || task.id === taskId)
          const results = yield* Effect.forEach(tasks, (task) =>
            Effect.tryPromise({
              try: () => session.query.stopTask(task.id),
              catch: (error) => new AgentError(String(error)),
            }).pipe(
              Effect.tap(() => Effect.sync(() => session.backgroundTasks.remove(task.id))),
              Effect.result
            )
          )
          yield* publishBackgroundTasks(session)
          yield* armIdle(session)
          const failed = results.find(Result.isFailure)
          if (failed) return yield* Effect.fail(failed.failure)
        })
      },
      stopWorkflow(threadId, taskId) {
        return Effect.gen(function* () {
          const session = sessions.get(threadId)
          if (!session || !current(session) || !session.runningWorkflows.has(taskId)) return false
          session.stoppedWorkflows.add(taskId)
          yield* Effect.tryPromise({
            try: () => session.query.stopTask(taskId),
            catch: (error) => new AgentError(String(error)),
          }).pipe(Effect.onError(() => Effect.sync(() => session.stoppedWorkflows.delete(taskId))))
          return true
        })
      },
      busy(threadId) {
        const session = sessions.get(threadId)
        return Boolean(
          session &&
          (session.wakePending || session.runningAgents.size || session.runningWorkflows.size)
        )
      },
      updateBot(bot) {
        const session = sessions.get(bot.id)
        if (!session || !current(session) || !session.bot) return Effect.void
        return applyOptions(
          session,
          sessionOptions({ ...bot, threadId: bot.id, turnId: session.activeTurnId, text: '' }, true)
        ).pipe(
          Effect.andThen(
            Effect.tryPromise({
              try: () =>
                session.query.applyFlagSettings(botAutoMode(bot.name, bot.allowRules ?? [])),
              catch: (error) => new AgentError(String(error)),
            })
          )
        )
      },
      setBotAllowRules(threadId, rules) {
        const session = sessions.get(threadId)
        if (!session || !session.bot) return Effect.void
        return Effect.gen(function* () {
          const bot = yield* store
            .getBot(threadId)
            .pipe(Effect.mapError((error) => new AgentError(error.message)))
          if (!bot) return
          yield* Effect.tryPromise({
            try: () => session.query.applyFlagSettings(botAutoMode(bot.name, rules)),
            catch: (error) => new AgentError(String(error)),
          })
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
                  ...(decision === 'always' && !sessions.get(threadId)?.bot
                    ? { updatedPermissions: pending.suggestions }
                    : {}),
                }
              : {
                  behavior: 'deny',
                  message: reason ? deniedApprovalNote(reason) : 'Denied by user',
                },
          (session, pending) =>
            Effect.gen(function* () {
              if (!pending.rule || decision !== 'always') return
              const bot = yield* store
                .getBot(threadId)
                .pipe(Effect.mapError((error) => new AgentError(error.message)))
              if (!bot) return
              const rule = { id: itemId, ...pending.rule, createdAt: Date.now() }
              const rules = [...(bot.allowRules ?? []).filter((rule) => rule.id !== itemId), rule]
              yield* Effect.tryPromise({
                try: () => session.query.applyFlagSettings(botAutoMode(bot.name, rules)),
                catch: (error) => new AgentError(String(error)),
              })
              yield* store
                .setBotAllowRules(threadId, rules)
                .pipe(Effect.mapError((error) => new AgentError(error.message)))
            })
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

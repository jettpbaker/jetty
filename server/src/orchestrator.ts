import type { EffortLevel, ThreadEvent } from '@jetty/shared/events'
import type {
  PermissionMode,
  ProviderId,
  QueuedMessage,
  ProviderModel,
  ProviderCapabilities,
  UploadAttachment,
  RunningSubagent,
  ThreadMeta,
} from '@jetty/shared/wire'

import {
  heldByRestarts,
  type ApprovalDecision,
  type Attachment,
  type ThreadItem,
} from '@jetty/shared/items'
import { findProviderModel } from '@jetty/shared/model-name'
import { newId } from '@jetty/shared/wire'
import { Context, Effect, Fiber, Layer, Queue, Semaphore } from 'effect'

import type { Attachments, PersistedAttachments } from './attachments'
import type { Hub } from './hub'
import type { AppendedEvent, Store } from './store'
import type { Worktrees } from './worktrees'

import { AgentError, compactFailureReason, couldntCompact, type Agent } from './agent'
import {
  CHILD_REPORT_INSTRUCTION,
  deniedApprovalNote,
  relayedMessage,
  userAnswers,
} from './jetty-instructions'
import {
  isAgentProvider,
  singleAgentRegistry,
  type AgentProvider,
  type AgentRegistry,
  type ProviderTitler,
} from './registry'
import { StoreError } from './store'
import { isFolder } from './worktrees'

const EMPTY_ATTACHMENTS: PersistedAttachments = { meta: [], images: [] }
const DELTA_BATCH = '50 millis'
// How long a removed queued message is kept, attachments and all, for Undo to put it back.
const REMOVED_KEPT = '30 seconds'

type ItemDelta = Extract<ThreadEvent, { type: 'item.delta' }>
type PullRequestItem = Extract<ThreadItem, { kind: 'pull_request' }>
export type PullRequestNews = {
  lines: Pick<PullRequestItem, 'repo' | 'number' | 'activity' | 'held'>[]
  text: string | null
}

export type Orchestrator = Effect.Success<ReturnType<typeof createOrchestrator>>
export const OrchestratorService = Context.Service<Orchestrator>('jetty/Orchestrator')

export type StartTurnInput = {
  threadId: string
  messageId?: string
  text: string
  attachments?: readonly UploadAttachment[]
  model?: string
  effort?: EffortLevel
  fast?: boolean
  permissionMode?: PermissionMode
  provider?: ProviderId
  queued?: QueuedMessage
  sendNow?: boolean
  resumeQueue?: boolean
  // The turn carries on the one before it, as the user's answer to its question does.
  carriesOn?: boolean
}

function registryFrom(agent: Agent | AgentRegistry): AgentRegistry {
  return 'defaultProvider' in agent ? agent : singleAgentRegistry(agent)
}

// An own shell command, not one a subagent ran. `command` and `cmd` are the shapes the
// providers report for Bash.
function ownShellCommand(item: ThreadItem | undefined) {
  if (!item || item.kind !== 'tool_call' || item.agentId) return null
  if (!/(?:bash|shell|exec|command)/i.test(item.toolName)) return null
  if (!item.input || typeof item.input !== 'object') return null
  const input = item.input as Record<string, unknown>
  if (typeof input.command === 'string') return input.command
  if (typeof input.cmd === 'string') return input.cmd
  return null
}

// A command at the start of the line or after a shell separator, not an argument of another one.
const GH_PR_CREATE = /(?:^|[;&|\n])\s*gh\s+pr\s+create(?:\s|$)/
const GH_PR_VIEW = /(?:^|[;&|\n])\s*gh\s+pr\s+view(?:\s|$)/
const GIT_PUSH = /(?:^|[;&|\n])\s*git\s+push(?:\s|$)/

function providerConflict(bound: string, requested: string) {
  return new StoreError('conflict', `Thread is bound to ${bound} and cannot switch to ${requested}`)
}

// Agents otherwise read a relayed message as the user's own words.
function agentText(
  { text, queued }: StartTurnInput,
  fromCreator: boolean,
  meta: readonly Attachment[],
  attachments: Attachments | null
) {
  return Effect.gen(function* () {
    const lines = text ? [text] : []
    if (attachments) {
      for (const attachment of meta) {
        const found = yield* attachments.resolve(attachment.id)
        if (!found) return yield* Effect.fail(new StoreError('not_found', 'Attachment is missing'))
        const kind = found.mimeType.startsWith('video/') ? 'video' : 'image'
        lines.push(`Attached ${kind} saved at ${found.path} (attachment id ${attachment.id}).`)
      }
    }
    const message = lines.join('\n')
    if (!queued?.from) return message
    const relayed = relayedMessage(queued.from, message)
    return fromCreator ? `${relayed}\n${CHILD_REPORT_INSTRUCTION}` : relayed
  }).pipe(
    Effect.mapError((error) =>
      error instanceof StoreError ? error : new StoreError('internal', String(error))
    )
  )
}

function toAgentError(error: Error) {
  return new AgentError(error.message)
}

// A worktree failure reaches the user with its own message, such as an archive script's output.
function worktreeTask<A>(task: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({
    try: task,
    catch: (error) =>
      error instanceof StoreError
        ? error
        : new StoreError('internal', error instanceof Error ? error.message : String(error)),
  })
}

function runningSubagents(items: readonly ThreadItem[]): RunningSubagent[] {
  return items.flatMap((item) =>
    item.kind === 'subagent' && item.status === 'running'
      ? [{ id: item.id, title: item.title, startedAt: item.createdAt }]
      : []
  )
}

type OrchestratorOptions = {
  store: Store
  agent: Agent | AgentRegistry
  hub: Hub
  worktrees?: Worktrees
  titler?: ProviderTitler | null
  attachments?: Attachments | null
  onPullRequestOutput?: (
    threadId: string,
    text: string,
    mode: 'transfer' | 'claim'
  ) => Effect.Effect<void, StoreError>
  onBranchPushed?: (threadId: string) => Effect.Effect<void, StoreError>
  modelCatalog?: () => Effect.Effect<readonly ProviderModel[]>
  // The last discovered models, read without re-running discovery.
  knownModels?: () => readonly ProviderModel[]
}

export function createOrchestrator({
  store,
  agent,
  hub,
  worktrees,
  titler = null,
  attachments = null,
  onPullRequestOutput,
  onBranchPushed,
  modelCatalog,
  knownModels,
}: OrchestratorOptions) {
  const registry = registryFrom(agent)
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    let closing = false
    const lifecycle = Semaphore.makeUnsafe(1)
    const resuming = new Map<string, AbortController>()
    hub.setThreads(yield* store.listThreads())
    const threads = new Map<
      string,
      {
        admission: Semaphore.Semaphore
        publication: Semaphore.Semaphore
        turnId: string | null
        ready: boolean
        pendingDelta: { event: ItemDelta; onCommit: Effect.Effect<void> } | null
      }
    >()

    yield* Effect.addFinalizer(() =>
      Effect.forEach(threads.keys(), (threadId) => locked(threadId, flushDelta(threadId)), {
        discard: true,
      }).pipe(Effect.ignore)
    )

    function state(threadId: string) {
      let value = threads.get(threadId)
      if (!value) {
        value = {
          admission: Semaphore.makeUnsafe(1),
          publication: Semaphore.makeUnsafe(1),
          turnId: null,
          ready: true,
          pendingDelta: null,
        }
        threads.set(threadId, value)
      }
      return value
    }

    // Ends the turn here too, so one whose end couldn't be saved doesn't hold up the queue, or a
    // stop, archive or delete waiting on it, forever.
    function settleTurn(threadId: string, turnId: string) {
      return Effect.sync(() => {
        const live = state(threadId)
        if (live.turnId === turnId) live.turnId = null
        live.ready = true
      }).pipe(Effect.andThen(Queue.offer(store.queueChanges, undefined)))
    }

    function interruptAdmittedThread(threadId: string) {
      return Effect.gen(function* () {
        const agent = yield* agentForThread(threadId)
        // An earlier queued upload may still be persisting between turns.
        yield* setQueuePaused(threadId, true)
        if (!state(threadId).turnId) return
        yield* agent.interrupt(threadId)
      })
    }

    // A worktree setup holds its thread's admission until it ends, so a stop ends the setup first.
    function stopSetup(threadId: string) {
      return Effect.sync(() => {
        const resume = resuming.get(threadId)
        resume?.abort()
        const stopped = worktrees?.stopSetup(threadId) ?? false
        return stopped || resume !== undefined
      })
    }

    function stopTreeSetups(threadId: string) {
      return store
        .threadTree(threadId)
        .pipe(
          Effect.flatMap((tree) =>
            Effect.forEach(tree, (thread) => stopSetup(thread.id), { discard: true })
          )
        )
    }

    function stopThread(threadId: string) {
      return stopSetup(threadId).pipe(
        Effect.andThen(state(threadId).admission.withPermit(stopAdmittedThread(threadId)))
      )
    }

    function stopAdmittedThread(threadId: string) {
      return Effect.gen(function* () {
        yield* store.suppressReport(threadId)
        yield* setQueuePaused(threadId, true)
        const agent = yield* agentForThread(threadId)
        yield* interruptAdmittedThread(threadId)
        if (agent.stopWorkflow) {
          const current = yield* store.getThreadState(threadId)
          for (const item of current.items)
            if (item.kind === 'workflow' && item.status === 'running')
              yield* agent.stopWorkflow(threadId, item.taskId)
        }
        if (agent.stopBackgroundTasks) yield* agent.stopBackgroundTasks(threadId)
        while (state(threadId).turnId || !state(threadId).ready) yield* Effect.sleep(10)
      })
    }

    function withTreeAdmission<A, E>(
      readTree: Effect.Effect<readonly ThreadMeta[], StoreError>,
      action: (tree: readonly ThreadMeta[]) => Effect.Effect<A, E>
    ) {
      return Effect.suspend(() => {
        const admitted = new Set<string>()
        function admit(): Effect.Effect<A, E | StoreError> {
          return Effect.gen(function* () {
            const tree = yield* readTree
            const next = tree.find((thread) => !admitted.has(thread.id))
            if (!next) return yield* action(tree)
            return yield* state(next.id).admission.withPermit(
              Effect.gen(function* () {
                admitted.add(next.id)
                return yield* admit()
              })
            )
          })
        }
        return admit()
      })
    }

    // Archive and Delete stop the tree's setups before queueing for the permit, which a group
    // Resume holds through every member's setup.
    function withLifecycle<A, E>(threadId: string, stopping: boolean, action: Effect.Effect<A, E>) {
      return (stopping ? stopTreeSetups(threadId) : Effect.void).pipe(
        Effect.andThen(lifecycle.withPermit(action))
      )
    }

    function archiveThread(threadId: string, archived: boolean) {
      return withLifecycle(
        threadId,
        archived,
        Effect.gen(function* () {
          if (archived) yield* stopTreeSetups(threadId)
          const resumed = !archived && worktrees ? yield* store.archiveGroup(threadId) : []
          for (const thread of resumed) resuming.set(thread.id, new AbortController())
          yield* withTreeAdmission(
            archived ? store.threadTree(threadId) : store.archiveGroup(threadId),
            (tree) =>
              Effect.gen(function* () {
                if (tree[0]!.archived === archived) return
                const group = archived ? tree.filter((thread) => !thread.archived) : tree
                if (archived) {
                  yield* checkTreeClean(tree)
                  for (const thread of tree) yield* stopAdmittedThread(thread.id)
                  yield* checkTreeClean(tree)
                  if (worktrees) {
                    for (const thread of group)
                      yield* worktreeTask(() => worktrees.cleanUp(thread.id))
                    yield* checkTreeClean(tree)
                    for (const thread of [...group].reverse())
                      yield* worktreeTask(() => worktrees.remove(thread.id, false, true))
                  }
                }
                yield* hub.withChromePublication(
                  store
                    .transaction(
                      Effect.gen(function* () {
                        for (const thread of group) {
                          yield* store.archiveThread(thread.id, archived)
                          if (!archived) {
                            const record = yield* store.getWorktree(thread.id)
                            if (record?.state === 'pending')
                              yield* store.saveWorktree(thread.id, {
                                ...record,
                                state: 'setting_up',
                                error: null,
                              })
                          }
                        }
                        if (archived)
                          yield* store.setArchiveGroup(
                            group.map((thread) => thread.id),
                            threadId
                          )
                      })
                    )
                    .pipe(
                      Effect.andThen(
                        Effect.gen(function* () {
                          for (const thread of group)
                            hub.pushChrome({
                              type: 'thread.upserted',
                              thread: yield* store.requireThread(thread.id),
                            })
                        })
                      )
                    )
                )
                if (!archived && worktrees) {
                  // A failed setup is its own thread's to Retry; the rest of the group still comes back.
                  const failures: StoreError[] = []
                  for (const thread of group) {
                    const resume = resuming.get(thread.id)?.signal
                    const prepared = yield* worktreeTask((signal) =>
                      worktrees.prepare(
                        thread.id,
                        resume ? AbortSignal.any([signal, resume]) : signal
                      )
                    ).pipe(Effect.result)
                    if (prepared._tag === 'Failure') failures.push(prepared.failure)
                  }
                  if (failures[0]) return yield* Effect.fail(failures[0])
                }
              })
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                for (const thread of resumed) resuming.delete(thread.id)
              })
            )
          )
        })
      )
    }

    function checkTreeClean(tree: readonly ThreadMeta[]) {
      return Effect.gen(function* () {
        if (!worktrees) return
        for (const thread of tree) {
          if (yield* worktreeTask(() => worktrees.dirty(thread.id)))
            return yield* Effect.fail(
              new StoreError(
                'conflict',
                `Cannot archive thread ${thread.title} (${thread.id}): commit or discard uncommitted worktree changes first`
              )
            )
          if (yield* worktreeTask(() => worktrees.detached(thread.id)))
            return yield* Effect.fail(
              new StoreError(
                'conflict',
                `Cannot archive thread ${thread.title} (${thread.id}): put the commits on its worktree's detached HEAD on a branch first`
              )
            )
        }
      })
    }

    function publish(threadId: string, appended: AppendedEvent) {
      return Effect.gen(function* () {
        hub.pushThread(threadId, {
          type: 'event',
          seq: appended.seq,
          ts: appended.ts,
          event: appended.event,
        })
        const subagentsChanged =
          (appended.event.type === 'item.started' ||
            appended.event.type === 'item.updated' ||
            appended.event.type === 'item.completed') &&
          hub.setRunningSubagents(threadId, runningSubagents(appended.state.items))
        if (appended.state.status !== appended.prevStatus || subagentsChanged) {
          const thread = yield* store.requireThread(threadId)
          hub.pushChrome({ type: 'thread.upserted', thread })
        }
      })
    }

    function commit(threadId: string, event: ThreadEvent, onCommit: Effect.Effect<void>) {
      return Effect.gen(function* () {
        const appended = yield* store.appendEvent(threadId, event)
        if (event.type === 'turn.started') state(threadId).turnId = event.turnId
        yield* onCommit
        yield* publish(threadId, appended)
        if (event.type === 'item.completed' && (onPullRequestOutput || onBranchPushed)) {
          const item = appended.state.items.find((candidate) => candidate.id === event.itemId)
          const command = ownShellCommand(item)
          if (command && item?.kind === 'tool_call') {
            // Creating a pull request takes it. Looking (`gh pr view`) links it only when no
            // thread has it. Pushing takes an open one already on this thread's branch.
            if (onPullRequestOutput && item.output.includes('github.com/')) {
              const mode = GH_PR_CREATE.test(command)
                ? 'transfer'
                : GH_PR_VIEW.test(command)
                  ? 'claim'
                  : null
              if (mode)
                yield* onPullRequestOutput(threadId, item.output, mode).pipe(
                  Effect.catchCause((cause) => Effect.logWarning(cause)),
                  Effect.forkIn(scope)
                )
            }
            if (onBranchPushed && item.status !== 'failed' && GIT_PUSH.test(command))
              yield* onBranchPushed(threadId).pipe(
                Effect.catchCause((cause) => Effect.logWarning(cause)),
                Effect.forkIn(scope)
              )
          }
        }
        if (event.type === 'turn.completed' || event.type === 'turn.failed') {
          state(threadId).turnId = null
          if (worktrees)
            yield* Effect.tryPromise(() => worktrees.refresh(threadId)).pipe(Effect.ignore)
        }
      })
    }

    function locked<A, E>(threadId: string, effect: Effect.Effect<A, E>) {
      return Effect.suspend(() =>
        state(threadId).publication.withPermit(
          hub.withChromePublication(effect).pipe(Effect.uninterruptible)
        )
      )
    }

    // Callers hold the thread's publication permit, so the batch lands before their own write.
    function flushDelta(threadId: string) {
      return Effect.suspend(() => {
        const live = state(threadId)
        const pending = live.pendingDelta
        if (!pending) return Effect.void
        live.pendingDelta = null
        return commit(threadId, pending.event, pending.onCommit)
      })
    }

    function bufferDelta(
      threadId: string,
      event: ItemDelta,
      onCommit: Effect.Effect<void>
    ): Effect.Effect<void, StoreError> {
      return Effect.suspend(() => {
        const live = state(threadId)
        const pending = live.pendingDelta
        if (pending && pending.event.itemId !== event.itemId)
          return locked(threadId, flushDelta(threadId)).pipe(
            Effect.andThen(bufferDelta(threadId, event, onCommit))
          )
        if (pending) {
          const tokens =
            pending.event.tokens === undefined && event.tokens === undefined
              ? {}
              : { tokens: (pending.event.tokens ?? 0) + (event.tokens ?? 0) }
          live.pendingDelta = {
            event: { ...pending.event, delta: pending.event.delta + event.delta, ...tokens },
            onCommit: pending.onCommit.pipe(Effect.andThen(onCommit)),
          }
          return Effect.void
        }
        live.pendingDelta = { event, onCommit }
        return Effect.sleep(DELTA_BATCH).pipe(
          Effect.andThen(locked(threadId, flushDelta(threadId))),
          Effect.catchCause((cause) => Effect.logWarning(cause)),
          Effect.forkIn(scope),
          Effect.asVoid
        )
      })
    }

    function append(
      threadId: string,
      event: ThreadEvent,
      onCommit = Effect.void,
      expectedTurnId?: string
    ) {
      if (event.type === 'item.delta') return bufferDelta(threadId, event, onCommit)
      return locked(
        threadId,
        Effect.gen(function* () {
          yield* flushDelta(threadId)
          if (expectedTurnId && state(threadId).turnId !== expectedTurnId)
            return yield* Effect.fail(new StoreError('conflict', 'Turn is no longer active'))
          if (
            event.type === 'turn.started' &&
            state(threadId).turnId &&
            state(threadId).turnId !== event.turnId
          )
            return yield* Effect.fail(new StoreError('conflict', 'Another turn is active'))
          if (closing) return
          const terminal = event.type === 'turn.completed' || event.type === 'turn.failed'
          if (terminal && state(threadId).turnId !== event.turnId) return
          if (event.type === 'turn.started' && !state(threadId).turnId)
            yield* store.carryOnTurn(threadId, event.turnId)
          yield* commit(threadId, event, onCommit)
        })
      )
    }

    function appendUser(
      { threadId, messageId, text, queued, carriesOn, sendNow }: StartTurnInput,
      turnId: string,
      meta: Attachment[],
      onCommit: Effect.Effect<void>
    ) {
      return Effect.gen(function* () {
        const item = {
          // The message keeps its id from the queue (or the client), so the client can tell it
          // is the same message whichever update reaches it first.
          id: queued?.id ?? messageId ?? newId(),
          turnId,
          createdAt: Date.now(),
          kind: 'user_message' as const,
          ...(queued ? { from: queued.from, hop: queued.hop } : {}),
          ...(queued?.reports && { reports: queued.reports }),
          text,
          attachments: meta,
        }
        return yield* locked(
          threadId,
          Effect.gen(function* () {
            yield* flushDelta(threadId)
            const appended = yield* store.transaction(
              Effect.gen(function* () {
                if (
                  queued?.kind === 'pull_request' &&
                  !sendNow &&
                  !(yield* store.getAgentBehaviours()).watchPullRequests
                ) {
                  yield* store.editQueued(threadId, queued.id)
                  return []
                }
                yield* store.beginDelivery(
                  threadId,
                  turnId,
                  queued?.hop ?? 0,
                  queued?.id,
                  carriesOn
                )
                return yield* store.appendEvents(threadId, [
                  { type: 'item.started', item },
                  { type: 'item.completed', itemId: item.id },
                ])
              })
            )
            yield* onCommit
            for (const event of appended) yield* publish(threadId, event)
            if (!appended.length)
              hub.pushChrome({
                type: 'thread.upserted',
                thread: yield* store.requireThread(threadId),
              })
            return appended.length > 0
          })
        )
      })
    }

    // One paid title request per thread, from its opening message, however fast follow-ups land.
    const titled = new Set<string>()
    function maybeTitle(threadId: string, provider: AgentProvider, text: string) {
      if (!titler || titled.has(threadId)) return Effect.void
      titled.add(threadId)
      return titler(provider, text, threadId).pipe(
        Effect.flatMap((title) =>
          hub.withChromePublication(
            Effect.gen(function* () {
              if (!title) return
              const updated = yield* store.setGeneratedTitle(threadId, title)
              if (!updated) return
              if (worktrees)
                yield* Effect.tryPromise(() => worktrees.rename(threadId, title)).pipe(
                  Effect.ignore
                )
              hub.pushChrome({
                type: 'thread.upserted',
                thread: yield* store.requireThread(threadId),
              })
            }).pipe(Effect.uninterruptible)
          )
        ),
        Effect.ignore,
        Effect.forkIn(scope),
        Effect.asVoid
      )
    }

    function soleInferredProvider(threadId: string) {
      return Effect.gen(function* () {
        const names = new Set(yield* store.listProviderSessionProviders(threadId))
        if (yield* store.getThreadSessionId(threadId)) names.add('claude')
        if (names.size > 1) {
          return yield* Effect.fail(
            new StoreError('conflict', 'Thread has resume state for more than one provider')
          )
        }
        const [only] = names
        return only ?? null
      })
    }

    function agentFor(provider: string) {
      if (isAgentProvider(provider)) {
        const agent = registry.agent(provider)
        if (agent) return Effect.succeed({ provider, agent })
      }
      return Effect.fail(new StoreError('invalid_params', `Provider ${provider} is not available`))
    }

    function chooseProvider(threadId: string, requested: ProviderId | undefined) {
      return Effect.gen(function* () {
        const column = yield* store.getThreadProvider(threadId)
        const existing = column ?? (yield* soleInferredProvider(threadId))
        if (existing && requested && requested !== existing) {
          return yield* Effect.fail(providerConflict(existing, requested))
        }
        const chosen = yield* agentFor(existing ?? requested ?? registry.defaultProvider)
        return { ...chosen, stored: column === chosen.provider }
      })
    }

    function commitProvider(threadId: string, provider: AgentProvider) {
      return Effect.gen(function* () {
        const written = yield* store.setThreadProviderIfAbsent(threadId, provider)
        yield* agentFor(written)
        if (written !== provider) return yield* Effect.fail(providerConflict(written, provider))
      })
    }

    function saveLoadout(input: StartTurnInput) {
      return hub.withChromePublication(
        Effect.gen(function* () {
          const thread = yield* store.setThreadLoadout(input.threadId, {
            model: input.model,
            effort: input.effort,
            fast: input.fast,
          })
          hub.pushChrome({ type: 'thread.upserted', thread })
        }).pipe(Effect.uninterruptible)
      )
    }

    function agentForThread(threadId: string) {
      return store.requireThread(threadId).pipe(
        Effect.andThen(store.getThreadProvider(threadId)),
        Effect.flatMap((column) => agentFor(column ?? registry.defaultProvider)),
        Effect.map(({ agent }) => agent)
      )
    }

    // Only files no chat shows and no queue holds: a queued message can carry images its chat
    // shows too, as when a restart re-sends a message the agent never got.
    function removeAttachments(meta: readonly Attachment[]) {
      if (!attachments) return Effect.void
      return store.unheldAttachments(meta.map((attachment) => attachment.id)).pipe(
        Effect.flatMap((ids) =>
          Effect.forEach(ids, (id) => attachments.remove(id), { discard: true })
        ),
        Effect.ignore
      )
    }

    const removedQueued = new Map<
      string,
      { message: QueuedMessage; index: number; fiber: Fiber.Fiber<void> }
    >()

    function forgetRemoved(key: string, fiber: Fiber.Fiber<void>) {
      return Effect.suspend(() => {
        const entry = removedQueued.get(key)
        if (entry?.fiber !== fiber) return Effect.void
        removedQueued.delete(key)
        return removeAttachments(entry.message.attachments ?? [])
      })
    }

    function keepRemoved(threadId: string, message: QueuedMessage, index: number) {
      return Effect.gen(function* () {
        const key = JSON.stringify([threadId, message.id])
        const fiber: Fiber.Fiber<void> = yield* Effect.sleep(REMOVED_KEPT).pipe(
          Effect.ensuring(Effect.suspend(() => forgetRemoved(key, fiber))),
          Effect.forkIn(scope)
        )
        removedQueued.set(key, { message, index, fiber })
      })
    }

    function setQueuePaused(threadId: string, paused: boolean) {
      return hub.withChromePublication(
        Effect.gen(function* () {
          const thread = yield* store.requireThread(threadId)
          if (thread.queuePaused === paused) return
          yield* store.setQueuePaused(threadId, paused)
          hub.pushChrome({
            type: 'thread.upserted',
            thread: { ...thread, queuePaused: paused },
          })
        })
      )
    }

    function requireFound(what: string) {
      return (found: boolean) =>
        found ? Effect.void : Effect.fail(new StoreError('not_found', `No pending ${what}`))
    }

    function startTurnEffect(input: StartTurnInput) {
      return Effect.gen(function* () {
        if (!input.queued && (yield* store.requireThread(input.threadId)).archived)
          yield* archiveThread(input.threadId, false)
        return yield* startAdmittedTurn(input)
      })
    }

    // A client whose connection dropped before the reply sends the same message again; the thread
    // answers from the first: queued (no turn, also once another tab removed it), or in the turn it
    // went into.
    function sentBefore(thread: ThreadMeta, messageId: string) {
      if (thread.pendingMessages?.some((message) => message.id === messageId))
        return Effect.succeed({ turnId: '' })
      return store.getThreadState(thread.id).pipe(
        Effect.flatMap((state) => {
          const item = state.items.find((candidate) => candidate.id === messageId)
          if (item) return Effect.succeed({ turnId: item.turnId })
          return store
            .wasQueued(thread.id, messageId)
            .pipe(Effect.map((queued) => (queued ? { turnId: '' } : undefined)))
        })
      )
    }

    function startAdmittedTurn(input: StartTurnInput) {
      return Effect.scoped(
        Effect.suspend(() =>
          state(input.threadId).admission.withPermit(
            Effect.gen(function* () {
              const thread = yield* store.requireThread(input.threadId)
              if (!input.queued && input.messageId) {
                const earlier = yield* sentBefore(thread, input.messageId)
                if (earlier) return earlier
              }
              if (thread.archived && !input.queued)
                return yield* Effect.fail(
                  new StoreError('conflict', 'Thread was archived before the turn could start')
                )
              const resumeQueue = !input.queued || (input.sendNow && input.resumeQueue !== false)
              let fromCreator = false
              if (input.queued) {
                if (
                  thread.archived ||
                  (thread.queuePaused && !input.sendNow) ||
                  !thread.pendingMessages?.some((m) => m.id === input.queued!.id)
                )
                  return { turnId: '' }
                if (
                  (thread.pendingMessages.find((m) => m.id === input.queued!.id)?.editingUntil ??
                    0) > Date.now()
                )
                  return { turnId: '' }
                if (input.sendNow && !state(input.threadId).turnId && !state(input.threadId).ready)
                  return yield* Effect.fail(new StoreError('conflict', 'No accepting turn'))
                if (
                  (!state(input.threadId).turnId && !state(input.threadId).ready) ||
                  (state(input.threadId).turnId && !input.sendNow)
                )
                  return { turnId: '' }
                const queued = yield* store.claimQueued(thread.id, input.queued.id)
                if (!queued) return { turnId: '' }
                yield* Effect.addFinalizer(() => store.releaseQueued(queued.id))
                // PR news the user switched off after it queued doesn't wake the agent.
                if (
                  queued.kind === 'pull_request' &&
                  !input.sendNow &&
                  !(yield* store.getAgentBehaviours()).watchPullRequests
                ) {
                  yield* store.editQueued(thread.id, queued.id)
                  return { turnId: '' }
                }
                fromCreator =
                  queued.from !== undefined &&
                  queued.from.threadId === thread.parentThreadId &&
                  (yield* store.notifiesParent(thread.id))
                input = {
                  ...input,
                  text: queued.text,
                  queued,
                  model: thread.model,
                  effort: thread.effort,
                  fast: thread.fast,
                  permissionMode: yield* store.getPermissionMode(thread.id),
                }
              }
              if (!state(input.threadId).turnId)
                yield* store.setPermissionMode(input.threadId, input.permissionMode)
              const chosen = yield* chooseProvider(input.threadId, input.provider)
              if (chosen.provider !== 'echo') {
                const model = input.model ?? thread.model
                const savedEffort = model && model === thread.model ? thread.effort : undefined
                const catalog =
                  modelCatalog && (!model || !(input.effort ?? savedEffort))
                    ? yield* modelCatalog()
                    : []
                const discovered = findProviderModel(catalog, chosen.provider, model)
                const selected = model
                  ? discovered
                  : catalog.find((candidate) => candidate.provider === chosen.provider)
                if (!model && modelCatalog && !selected && chosen.provider !== 'grok')
                  return yield* Effect.fail(
                    new StoreError('internal', `No model available for ${chosen.provider}`)
                  )
                const picked = model ?? selected?.id
                // An alias (`opus[1m]`) moves when a new model ships; the thread keeps the model
                // it actually ran, so a conversation never switches underneath the user.
                const alias = findProviderModel(knownModels?.() ?? catalog, chosen.provider, picked)
                input = {
                  ...input,
                  model: alias?.id === picked && alias?.resolvedId ? alias.resolvedId : picked,
                  effort:
                    input.effort ??
                    savedEffort ??
                    selected?.defaultEffort ??
                    (selected?.efforts.includes('high') ? 'high' : selected?.efforts.at(-1)),
                  fast:
                    input.fast ?? (model && model === thread.model ? thread.fast : false) ?? false,
                }
              }
              let committed = false
              const onCommit = Effect.sync(() => {
                committed = true
              })
              const queuedMeta = input.queued?.attachments ?? []
              const saved = !attachments
                ? EMPTY_ATTACHMENTS
                : queuedMeta.length
                  ? { meta: [...queuedMeta], images: yield* attachments.load(queuedMeta) }
                  : yield* Effect.acquireRelease(
                      attachments.persist(input.attachments),
                      (saved) =>
                        committed
                          ? Effect.void
                          : Effect.forEach(
                              saved.meta,
                              (attachment) => attachments.remove(attachment.id),
                              { discard: true }
                            ),
                      { interruptible: true }
                    ).pipe(
                      Effect.mapError((error) =>
                        error instanceof StoreError
                          ? error
                          : new StoreError('internal', String(error))
                      )
                    )
              if (!chosen.stored) yield* commitProvider(input.threadId, chosen.provider)
              yield* saveLoadout(input)
              const { agent } = chosen
              let cwd: string | undefined
              if (worktrees && !state(input.threadId).turnId) {
                const message: QueuedMessage = {
                  id: input.messageId ?? newId(),
                  text: input.text,
                  createdAt: Date.now(),
                  hop: 0,
                  attachments: saved.meta,
                  ...(input.carriesOn && { carriesOn: true as const }),
                }
                // The message waits in the queue while the worktree is prepared, so a stopped
                // or failed setup keeps it for Resume.
                if (thread.environment === 'worktree' && !input.queued) {
                  yield* store.enqueue(thread.id, message)
                  yield* onCommit
                  input = { ...input, queued: message }
                }
                const preparing = state(input.threadId)
                preparing.ready = false
                const prepared = yield* worktreeTask((signal) =>
                  worktrees.prepare(input.threadId, signal)
                ).pipe(
                  Effect.interruptible,
                  Effect.result,
                  Effect.ensuring(
                    Effect.sync(() => {
                      preparing.ready = true
                    })
                  )
                )
                if (prepared._tag === 'Failure') {
                  yield* setQueuePaused(thread.id, true)
                  // A Current checkout's message joins the paused queue only now, so a stopped or
                  // failed preparation keeps it for Resume all the same.
                  if (!input.queued) {
                    yield* hub.withChromePublication(
                      store
                        .enqueue(thread.id, message)
                        .pipe(
                          Effect.tap((queued) =>
                            Effect.sync(() =>
                              hub.pushChrome({ type: 'thread.upserted', thread: queued })
                            )
                          )
                        )
                    )
                    yield* onCommit
                  }
                  return { turnId: '' }
                }
                cwd = prepared.success
              }
              if (input.text && (yield* store.needsGeneratedTitle(input.threadId)))
                yield* maybeTitle(input.threadId, chosen.provider, input.text)
              const text = yield* agentText(input, fromCreator, saved.meta, attachments)
              const live = state(input.threadId)
              if (live.turnId) {
                const turnId = live.turnId
                const accepted = yield* agent.steer(
                  input.threadId,
                  text,
                  saved.images,
                  appendUser(input, turnId, saved.meta, onCommit).pipe(
                    Effect.asVoid,
                    Effect.mapError(toAgentError)
                  )
                )
                if (!accepted) {
                  return yield* Effect.fail(
                    new StoreError('internal', 'Active turn is not accepting input')
                  )
                }
                if (resumeQueue) yield* setQueuePaused(input.threadId, false)
                return { turnId }
              }
              const turnId = newId()
              live.turnId = turnId
              live.ready = false
              const loadout = input.model && {
                model: input.model,
                effort: input.effort,
                fast: input.fast,
              }
              const emit = (event: ThreadEvent, onCommit?: Effect.Effect<void>) =>
                append(
                  input.threadId,
                  loadout && event.type === 'turn.started' ? { ...event, loadout } : event,
                  onCommit
                ).pipe(Effect.mapError(toAgentError))
              const turn = yield* appendUser(input, turnId, saved.meta, onCommit).pipe(
                Effect.flatMap((delivered) =>
                  delivered
                    ? Effect.gen(function* () {
                        const folder = cwd
                        if (folder && !(yield* Effect.promise(() => isFolder(folder)))) {
                          const message = `Project folder not found: ${folder}`
                          const item = {
                            id: newId(),
                            turnId,
                            createdAt: Date.now(),
                            kind: 'error' as const,
                            message,
                          }
                          return {
                            await: emit({ type: 'item.started', item }).pipe(
                              Effect.andThen(Effect.fail(new AgentError(message)))
                            ),
                          }
                        }
                        return yield* agent.startTurn(
                          {
                            cwd,
                            threadId: input.threadId,
                            turnId,
                            text,
                            images: saved.images,
                            model: input.model,
                            effort: input.effort,
                            fast: input.fast,
                            permissionMode: input.permissionMode,
                            parentThreadId: thread.parentThreadId,
                          },
                          emit
                        )
                      })
                    : Effect.succeed(undefined)
                ),
                Effect.onError(() =>
                  append(input.threadId, {
                    type: 'turn.failed',
                    turnId,
                    error: 'Unable to start turn',
                  }).pipe(Effect.ignore, Effect.ensuring(settleTurn(input.threadId, turnId)))
                )
              )
              if (!turn) {
                live.turnId = null
                live.ready = true
                return { turnId: '' }
              }
              if (resumeQueue) yield* setQueuePaused(input.threadId, false)
              yield* turn.await.pipe(
                Effect.catch((error) =>
                  emit({ type: 'turn.failed', turnId, error: error.message })
                ),
                Effect.onInterrupt(() =>
                  emit({ type: 'turn.failed', turnId, error: 'server shutdown' }).pipe(
                    Effect.ignore
                  )
                ),
                Effect.ensuring(settleTurn(input.threadId, turnId)),
                Effect.forkIn(scope, { startImmediately: true })
              )
              return { turnId }
            })
          )
        )
      )
    }

    return {
      providerCapabilities() {
        return Object.fromEntries(
          (['claude', 'codex', 'grok'] as const).map((provider) => [
            provider,
            { compaction: registry.agent(provider)?.supportsCompaction === true },
          ])
        ) as ProviderCapabilities
      },
      compact(threadId: string) {
        return Effect.suspend(() =>
          state(threadId).admission.withPermit(
            Effect.gen(function* () {
              const thread = yield* store.requireThread(threadId)
              const agent = yield* agentForThread(threadId)
              const live = state(threadId)
              if (live.turnId || !live.ready || agent.busy?.(threadId))
                return yield* Effect.fail(
                  new StoreError('conflict', 'Wait for this turn to finish')
                )
              if (!agent.supportsCompaction)
                return yield* Effect.fail(
                  new StoreError('conflict', 'This provider does not support compaction')
                )
              const snapshot = yield* store.getThreadState(threadId)
              if (!snapshot.items.length)
                return yield* Effect.fail(new StoreError('conflict', 'Send a message first'))
              if (thread.archived)
                return yield* Effect.fail(new StoreError('conflict', 'Resume this thread first'))
              const project = yield* store.getProject(thread.projectId)
              if (!project)
                return yield* Effect.fail(new StoreError('not_found', 'Thread project not found'))
              const cwd = worktrees
                ? yield* worktreeTask((signal) => worktrees.prepare(threadId, signal))
                : (thread.workingPath ?? project.path)
              const turnId = newId()
              live.turnId = turnId
              live.ready = false
              let compactNoted = false
              const emit = (event: ThreadEvent, onCommit?: Effect.Effect<void>) => {
                if (
                  event.type === 'item.started' &&
                  event.item.kind === 'error' &&
                  event.item.message.startsWith("Couldn't compact:")
                )
                  compactNoted = true
                return append(threadId, event, onCommit).pipe(Effect.mapError(toAgentError))
              }
              const lifecycle = agent
                .startTurn(
                  {
                    threadId,
                    turnId,
                    cwd,
                    text: '',
                    compact: true,
                    model: thread.model,
                    effort: thread.effort,
                    fast: thread.fast,
                    parentThreadId: thread.parentThreadId,
                  },
                  emit
                )
                .pipe(
                  Effect.flatMap((turn) => turn.await),
                  Effect.catch((error) => {
                    const detail = compactFailureReason(false, error.message)
                    return (
                      compactNoted || !detail ? Effect.void : emit(couldntCompact(turnId, detail))
                    ).pipe(
                      Effect.andThen(emit({ type: 'turn.failed', turnId, error: error.message }))
                    )
                  }),
                  Effect.onInterrupt(() =>
                    emit({ type: 'turn.failed', turnId, error: 'server shutdown' }).pipe(
                      Effect.ignore
                    )
                  ),
                  Effect.ensuring(settleTurn(threadId, turnId))
                )
              yield* Effect.forkIn(lifecycle, scope, { startImmediately: true })
            })
          )
        )
      },
      beginShutdown() {
        return Effect.sync(() => {
          closing = true
        })
      },
      markReadyForReview(threadId: string) {
        return Effect.gen(function* () {
          const thread = yield* store.requireThread(threadId)
          // An agent-created thread reports to its parent automatically when settled.
          if (thread.parentThreadId) return thread
          return yield* hub.withChromePublication(
            store
              .markReadyForReview(threadId)
              .pipe(
                Effect.tap((marked) =>
                  Effect.sync(() => hub.pushChrome({ type: 'thread.upserted', thread: marked }))
                )
              )
          )
        })
      },
      withAdmission<A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) {
        return state(threadId).admission.withPermit(effect)
      },
      withPublication<A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) {
        return Effect.suspend(() => state(threadId).publication.withPermit(effect))
      },
      startTurnEffect,
      setQueuePaused,
      // Tells clients, and the queue, about a thread whose queue a store transaction resumed.
      queueResumed(threadId: string) {
        return hub.withChromePublication(
          Effect.gen(function* () {
            hub.pushChrome({
              type: 'thread.upserted',
              thread: yield* store.requireThread(threadId),
            })
            yield* Queue.offer(store.queueChanges, undefined)
          })
        )
      },
      // Resumes a thread the crash-loop guard held as a restart would have: Jetty's note goes first
      // in its queue. A thread that has moved on is left alone, so a second press sends nothing.
      continueThread(threadId: string) {
        return state(threadId).admission.withPermit(
          hub.withChromePublication(
            Effect.gen(function* () {
              const { items } = yield* store.getThreadState(threadId)
              if (state(threadId).turnId || !heldByRestarts(items)) return
              yield* store.transaction(
                Effect.gen(function* () {
                  const thread = yield* store.requireThread(threadId)
                  if (!thread.pendingMessages?.some((message) => message.kind === 'continuation'))
                    yield* store.enqueue(
                      threadId,
                      yield* store.continuation(threadId, items.at(-1)!.turnId),
                      0
                    )
                  yield* store.setQueuePaused(threadId, false)
                })
              )
              hub.pushChrome({
                type: 'thread.upserted',
                thread: yield* store.requireThread(threadId),
              })
              yield* Queue.offer(store.queueChanges, undefined)
            })
          )
        )
      },
      // The PR watcher's lines join the running turn, or the last one, so they never open a turn
      // of their own; what needs the agent waits in its queue like a report. The news is taken in
      // the transaction that tells the thread, so a restart neither repeats nor drops it.
      pullRequestActivity(threadId: string, take: Effect.Effect<PullRequestNews, StoreError>) {
        return locked(
          threadId,
          Effect.gen(function* () {
            yield* flushDelta(threadId)
            const appended = yield* store.transaction(
              Effect.gen(function* () {
                const { lines, text } = yield* take
                const thread = yield* store.getThread(threadId)
                if (!thread || thread.archived || !lines.length) return []
                const { items } = yield* store.getThreadState(threadId)
                const turnId = state(threadId).turnId ?? items.at(-1)?.turnId ?? newId()
                const events = lines.flatMap((line): ThreadEvent[] => {
                  const item: PullRequestItem = {
                    ...line,
                    id: newId(),
                    turnId,
                    createdAt: Date.now(),
                    kind: 'pull_request',
                  }
                  return [
                    { type: 'item.started', item },
                    { type: 'item.completed', itemId: item.id },
                  ]
                })
                const appended = yield* store.appendEvents(
                  threadId,
                  events as [ThreadEvent, ...ThreadEvent[]]
                )
                if (text) yield* store.queuePullRequestNews(threadId, text)
                return appended
              })
            )
            if (!appended.length) return
            for (const event of appended) yield* publish(threadId, event)
            hub.pushChrome({
              type: 'thread.upserted',
              thread: yield* store.requireThread(threadId),
            })
          })
        )
      },
      currentTurn(threadId: string) {
        return state(threadId).turnId
      },
      emitMedia(
        threadId: string,
        turnId: string,
        event: ThreadEvent,
        onCommit: Effect.Effect<void>
      ) {
        return Effect.suspend(() =>
          state(threadId).turnId === turnId
            ? append(threadId, event, onCommit, turnId)
            : Effect.fail(new StoreError('conflict', 'Turn is no longer active'))
        )
      },
      enqueue(
        threadId: string,
        messageId: string,
        text: string,
        uploads?: readonly UploadAttachment[]
      ) {
        return Effect.gen(function* () {
          if (!text && !uploads?.length)
            return yield* Effect.fail(new StoreError('invalid_params', 'Message is empty'))
          if (yield* sentBefore(yield* store.requireThread(threadId), messageId)) return
          const saved = attachments ? yield* attachments.persist(uploads) : EMPTY_ATTACHMENTS
          const thread = yield* hub
            .withChromePublication(
              store
                .enqueueOnce(threadId, {
                  id: messageId,
                  text,
                  createdAt: Date.now(),
                  hop: 0,
                  ...(saved.meta.length ? { attachments: saved.meta } : {}),
                })
                .pipe(
                  Effect.tap((thread) =>
                    Effect.sync(() => {
                      if (thread) hub.pushChrome({ type: 'thread.upserted', thread })
                    })
                  ),
                  Effect.uninterruptible
                )
            )
            .pipe(Effect.onError(() => removeAttachments(saved.meta)))
          if (!thread) yield* removeAttachments(saved.meta)
        })
      },
      editQueued(threadId: string, messageId: string, text?: string) {
        return state(threadId).admission.withPermit(
          hub.withChromePublication(
            Effect.gen(function* () {
              const before = yield* store.requireThread(threadId)
              const thread = yield* store.editQueued(threadId, messageId, text)
              hub.pushChrome({ type: 'thread.upserted', thread })
              const index = before.pendingMessages?.findIndex((m) => m.id === messageId) ?? -1
              if (text === undefined && index !== -1)
                yield* keepRemoved(threadId, before.pendingMessages![index]!, index)
            }).pipe(Effect.uninterruptible)
          )
        )
      },
      // Undo for a remove: the message goes back where it was, if it was removed recently.
      restoreQueued(threadId: string, messageId: string) {
        return state(threadId).admission.withPermit(
          hub.withChromePublication(
            Effect.gen(function* () {
              const key = JSON.stringify([threadId, messageId])
              const entry = removedQueued.get(key)
              if (!entry)
                return yield* Effect.fail(new StoreError('not_found', 'Removed message not found'))
              removedQueued.delete(key)
              yield* Fiber.interrupt(entry.fiber)
              const { editingUntil: _, ...message } = entry.message
              const thread = yield* store
                .enqueue(threadId, message, entry.index)
                .pipe(Effect.onError(() => removeAttachments(message.attachments ?? [])))
              hub.pushChrome({ type: 'thread.upserted', thread })
            }).pipe(Effect.uninterruptible)
          )
        )
      },
      setQueuedEditing(threadId: string, messageId: string, editing: boolean) {
        return state(threadId).admission.withPermit(
          hub.withChromePublication(
            store.setQueuedEditing(threadId, messageId, editing).pipe(
              Effect.tap((thread) =>
                Effect.sync(() => hub.pushChrome({ type: 'thread.upserted', thread }))
              ),
              Effect.uninterruptible
            )
          )
        )
      },
      sendQueuedNow(threadId: string, messageId: string, byUser = true) {
        return Effect.gen(function* () {
          if (!byUser && (yield* store.isQueuePaused(threadId)))
            return yield* Effect.fail(new StoreError('conflict', 'Queue is paused'))
          const thread = yield* store.requireThread(threadId)
          const queued = thread.pendingMessages?.find((m) => m.id === messageId)
          if (!queued)
            return yield* Effect.fail(new StoreError('not_found', 'Queued message not found'))
          const result = yield* startTurnEffect({
            threadId,
            text: queued.text,
            queued,
            sendNow: true,
            resumeQueue: byUser,
          })
          if (!result.turnId)
            return yield* Effect.fail(new StoreError('conflict', 'Queued message was not accepted'))
          // Steering leaves the status unchanged, so nothing else republishes the shorter queue.
          yield* hub.withChromePublication(
            store
              .requireThread(threadId)
              .pipe(
                Effect.tap((current) =>
                  Effect.sync(() => hub.pushChrome({ type: 'thread.upserted', thread: current }))
                )
              )
          )
        })
      },
      resumeQueues() {
        const published = new Map<string, string>()
        // Each append bumps updatedAt, so a child whose row hasn't changed since its last check
        // can't have newly settled; the drain runs every second and this keeps it cheap.
        const checked = new Map<string, string>()
        const drain = Effect.gen(function* () {
          const threads = yield* store.listThreads()
          const children = new Map<string, ThreadMeta[]>()
          for (const thread of threads)
            if (thread.parentThreadId && !thread.archived)
              children.set(thread.parentThreadId, [
                ...(children.get(thread.parentThreadId) ?? []),
                thread,
              ])
          function agentBusy(thread: ThreadMeta) {
            const provider = thread.provider ?? registry.defaultProvider
            return isAgentProvider(provider) && Boolean(registry.agent(provider)?.busy?.(thread.id))
          }
          // A thread still waiting on its own children isn't done; a stopped (paused) one is.
          function busy(thread: ThreadMeta): boolean {
            const runtime = state(thread.id)
            return (
              !runtime.ready ||
              Boolean(runtime.turnId) ||
              agentBusy(thread) ||
              (!thread.awaitingParent &&
                (thread.status === 'running' || thread.status === 'awaiting_approval')) ||
              Boolean(hub.decorateThread(thread).backgroundTasks?.length) ||
              Boolean(thread.pendingMessages?.length && !thread.queuePaused) ||
              (children.get(thread.id) ?? []).some(busy)
            )
          }
          for (const thread of threads) {
            if (closing) return
            if (
              thread.createdBy !== 'agent' ||
              !thread.parentThreadId ||
              !state(thread.id).ready ||
              state(thread.id).turnId
            )
              continue
            const working =
              agentBusy(thread) ||
              Boolean(hub.decorateThread(thread).backgroundTasks?.length) ||
              (children.get(thread.id) ?? []).some(busy)
            const key = `${thread.updatedAt}:${thread.pendingMessages?.length ?? 0}:${working}`
            if (checked.get(thread.id) === key) continue
            checked.set(thread.id, key)
            yield* locked(
              thread.id,
              Effect.gen(function* () {
                const result = yield* store.reportSettledChild(
                  thread.id,
                  working || agentBusy(thread)
                )
                if ('note' in result && result.note) yield* publish(thread.id, result.note)
                if ('asked' in result)
                  hub.pushChrome({
                    type: 'thread.upserted',
                    thread: yield* store.requireThread(thread.id),
                  })
              })
            ).pipe(Effect.onError(() => Effect.sync(() => checked.delete(thread.id))))
          }
          for (const thread of yield* store.listThreads()) {
            if (closing) return
            const queue = thread.pendingMessages ?? []
            if ((published.get(thread.id) ?? '[]') !== JSON.stringify(queue)) {
              yield* hub.withChromePublication(
                Effect.gen(function* () {
                  const current = yield* store.getThread(thread.id)
                  if (!current) return
                  published.set(thread.id, JSON.stringify(current.pendingMessages ?? []))
                  hub.pushChrome({ type: 'thread.upserted', thread: current })
                })
              )
            }
            if (
              thread.archived ||
              thread.worktree?.state === 'setting_up' ||
              (yield* store.isQueuePaused(thread.id)) ||
              state(thread.id).turnId ||
              !state(thread.id).ready ||
              !queue[0] ||
              (queue[0].editingUntil ?? 0) > Date.now()
            )
              continue
            const start = startTurnEffect({
              threadId: thread.id,
              text: queue[0].text,
              queued: queue[0],
            }).pipe(
              Effect.catchCause((cause) =>
                locked(
                  thread.id,
                  Effect.gen(function* () {
                    yield* flushDelta(thread.id)
                    const appended = yield* store.transaction(
                      Effect.gen(function* () {
                        const current = yield* store.getThread(thread.id)
                        // The first failure pauses the queue; starts that failed alongside it add nothing.
                        if (
                          !current?.pendingMessages?.some((m) => m.id === queue[0]!.id) ||
                          current.queuePaused
                        )
                          return
                        yield* store.setQueuePaused(thread.id, true)
                        return yield* store.appendEvent(thread.id, {
                          type: 'item.started',
                          item: {
                            id: newId(),
                            turnId: newId(),
                            createdAt: Date.now(),
                            kind: 'error',
                            message: String(cause),
                          },
                        })
                      })
                    )
                    if (!appended) return
                    yield* publish(thread.id, appended)
                    hub.pushChrome({
                      type: 'thread.upserted',
                      thread: yield* store.requireThread(thread.id),
                    })
                  })
                ).pipe(Effect.catchCause((failure) => Effect.logError(failure)))
              )
            )
            yield* start.pipe(Effect.forkIn(scope))
          }
        })
        return Effect.forever(
          drain.pipe(
            Effect.andThen(Queue.take(store.queueChanges).pipe(Effect.timeoutOption(1000))),
            Effect.catchCause((cause) =>
              Effect.logError(cause).pipe(Effect.andThen(Effect.sleep(100)))
            )
          )
        ).pipe(Effect.forkIn(scope), Effect.asVoid)
      },
      stopThread,
      archiveThread,
      interrupt(threadId: string) {
        return stopSetup(threadId).pipe(
          Effect.flatMap((stopped) =>
            stopped
              ? Effect.void
              : state(threadId).admission.withPermit(interruptAdmittedThread(threadId))
          )
        )
      },
      stopBackgroundTasks(threadId: string, taskId?: string) {
        return Effect.gen(function* () {
          const agent = yield* agentForThread(threadId)
          if (!agent.stopBackgroundTasks)
            return yield* Effect.fail(new StoreError('not_found', 'Background tasks not supported'))
          yield* agent.stopBackgroundTasks(threadId, taskId)
        })
      },
      stopWorkflow(threadId: string, taskId: string) {
        return Effect.gen(function* () {
          yield* store.requireThread(threadId)
          const agent = yield* agentForThread(threadId)
          if (!agent.stopWorkflow || !(yield* agent.stopWorkflow(threadId, taskId)))
            return yield* Effect.fail(new StoreError('not_found', 'Running workflow not found'))
        })
      },
      respondApproval(
        threadId: string,
        itemId: string,
        decision: ApprovalDecision,
        message?: string
      ) {
        return Effect.gen(function* () {
          const provider = yield* store.getThreadProvider(threadId)
          const agent = yield* agentForThread(threadId)
          yield* requireFound(`approval ${itemId}`)(
            yield* agent.respondToApproval(threadId, itemId, decision, message)
          )
          if (decision === 'deny' && message?.trim() && provider === 'grok')
            yield* agent.steer(threadId, deniedApprovalNote(message.trim()))
        })
      },
      respondQuestion(threadId: string, itemId: string, answers: Record<string, string> | null) {
        return Effect.gen(function* () {
          const agent = yield* agentForThread(threadId)
          if (yield* agent.respondToQuestion(threadId, itemId, answers)) return
          const thread = yield* store.requireThread(threadId)
          const current = yield* store.getThreadState(threadId)
          const item = current.items.find((candidate) => candidate.id === itemId)
          if (
            thread.provider !== 'codex' ||
            item?.kind !== 'question' ||
            item.delivery !== 'async' ||
            item.answers ||
            item.dismissed
          )
            return yield* Effect.fail(new StoreError('not_found', `No pending question ${itemId}`))
          if (answers) {
            const text = userAnswers(
              item.questions.map(({ question }) => `${question}: ${answers[question] ?? ''}`)
            )
            yield* startTurnEffect({
              threadId,
              text,
              model: thread.model,
              effort: thread.effort,
              fast: thread.fast,
              permissionMode: yield* store.getPermissionMode(threadId),
              carriesOn: true,
            })
          }
          yield* append(threadId, {
            type: 'item.completed',
            itemId,
            patch: answers ? { answers } : { dismissed: true },
          })
        })
      },
      deleteThread(threadId: string) {
        return withLifecycle(
          threadId,
          true,
          Effect.gen(function* () {
            yield* stopTreeSetups(threadId)
            yield* withTreeAdmission(store.threadTree(threadId), (tree) =>
              Effect.gen(function* () {
                for (const thread of tree) yield* stopAdmittedThread(thread.id)
                for (const thread of [...tree].reverse()) {
                  if (worktrees)
                    yield* worktreeTask(() => worktrees.cleanUp(thread.id)).pipe(
                      Effect.catch((error) => Effect.logWarning(error.message))
                    )
                  yield* locked(
                    thread.id,
                    Effect.gen(function* () {
                      yield* flushDelta(thread.id)
                      if (worktrees) yield* worktreeTask(() => worktrees.remove(thread.id, true))
                      const attachmentIds = yield* store.deleteThread(thread.id)
                      if (attachments)
                        yield* Effect.forEach(attachmentIds, (id) => attachments.remove(id), {
                          discard: true,
                        })
                      hub.pushChrome({ type: 'thread.removed', threadId: thread.id })
                    })
                  )
                }
              })
            )
          })
        )
      },
      isActive(threadId: string) {
        return Effect.gen(function* () {
          return (
            !!state(threadId).turnId ||
            (yield* store.getThreadState(threadId)).activeTurnId !== null
          )
        })
      },
    }
  })
}

export function orchestratorLayer(options: OrchestratorOptions) {
  return Layer.effect(OrchestratorService, createOrchestrator(options))
}

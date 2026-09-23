import type { ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, Attachment } from '@jetty/shared/items'
import type {
  EffortLevel,
  PermissionMode,
  ProviderId,
  QueuedMessage,
  UploadAttachment,
} from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Context, Effect, Layer, Queue, Semaphore } from 'effect'

import type { Attachments, PersistedAttachments } from './attachments'
import type { Hub } from './hub'
import type { ReviewClassifier } from './review'
import type { AppendedEvent, Store } from './store'

import { AgentError, type Agent } from './agent'
import {
  isAgentProvider,
  singleAgentRegistry,
  type AgentProvider,
  type AgentRegistry,
  type ProviderTitler,
} from './registry'
import { StoreError } from './store'

const EMPTY_ATTACHMENTS: PersistedAttachments = { meta: [], images: [] }

export type Orchestrator = Effect.Success<ReturnType<typeof createOrchestrator>>
export const OrchestratorService = Context.Service<Orchestrator>('jetty/Orchestrator')

export type StartTurnInput = {
  threadId: string
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
}

function registryFrom(agent: Agent | AgentRegistry): AgentRegistry {
  return 'defaultProvider' in agent ? agent : singleAgentRegistry(agent)
}

function providerConflict(bound: string, requested: string) {
  return new StoreError('conflict', `Thread is bound to ${bound} and cannot switch to ${requested}`)
}

function toAgentError(error: Error) {
  return new AgentError(error.message)
}

export function createOrchestrator(
  store: Store,
  agent: Agent | AgentRegistry,
  hub: Hub,
  titler: ProviderTitler | null = null,
  attachments: Attachments | null = null,
  onCompletedText?: (threadId: string, text: string) => Effect.Effect<void>,
  reviewer?: ReviewClassifier
) {
  const registry = registryFrom(agent)
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    const threads = new Map<
      string,
      {
        admission: Semaphore.Semaphore
        publication: Semaphore.Semaphore
        turnId: string | null
        ready: boolean
      }
    >()

    function state(threadId: string) {
      let value = threads.get(threadId)
      if (!value) {
        value = {
          admission: Semaphore.makeUnsafe(1),
          publication: Semaphore.makeUnsafe(1),
          turnId: null,
          ready: true,
        }
        threads.set(threadId, value)
      }
      return value
    }

    function publish(threadId: string, appended: AppendedEvent) {
      hub.pushThread(threadId, {
        type: 'event',
        seq: appended.seq,
        ts: appended.ts,
        event: appended.event,
      })
      if (appended.state.status !== appended.prevStatus) {
        hub.pushChrome({ type: 'thread.upserted', thread: appended.thread })
      }
    }

    function append(
      threadId: string,
      event: ThreadEvent,
      onCommit = Effect.void,
      expectedTurnId?: string
    ) {
      return Effect.suspend(() =>
        state(threadId).publication.withPermit(
          hub
            .withChromePublication(
              Effect.gen(function* () {
                if (expectedTurnId && state(threadId).turnId !== expectedTurnId)
                  return yield* Effect.fail(new StoreError('conflict', 'Turn is no longer active'))
                if (
                  event.type === 'turn.started' &&
                  state(threadId).turnId &&
                  state(threadId).turnId !== event.turnId
                )
                  return yield* Effect.fail(new StoreError('conflict', 'Another turn is active'))
                const terminal = event.type === 'turn.completed' || event.type === 'turn.failed'
                if (terminal && state(threadId).turnId !== event.turnId) return
                const appended = yield* store.appendEvent(threadId, event)
                if (event.type === 'turn.started') state(threadId).turnId = event.turnId
                yield* onCommit
                publish(threadId, appended)
                if (event.type === 'turn.completed' && reviewer) {
                  const reply = [...appended.state.items]
                    .reverse()
                    .find(
                      (item) => item.turnId === event.turnId && item.kind === 'assistant_message'
                    )
                  if (reply?.kind === 'assistant_message' && reply.text.trim()) {
                    yield* Effect.gen(function* () {
                      if (yield* store.parentGetsNotification(threadId, event.turnId)) return
                      if (!(yield* reviewer(reply.text))) return
                      yield* hub.withChromePublication(
                        store.setReadyForReview(threadId, appended.thread.turnEndedAt!).pipe(
                          Effect.tap((thread) =>
                            Effect.sync(() => {
                              if (thread) hub.pushChrome({ type: 'thread.upserted', thread })
                            })
                          )
                        )
                      )
                    }).pipe(
                      Effect.catchCause((cause) => Effect.logWarning(cause)),
                      Effect.forkIn(scope)
                    )
                  }
                }
                if (event.type === 'item.completed' && onCompletedText) {
                  const item = appended.state.items.find(
                    (candidate) => candidate.id === event.itemId
                  )
                  if (item?.kind === 'assistant_message' || item?.kind === 'tool_call') {
                    const text = item.kind === 'assistant_message' ? item.text : item.output
                    if (text.includes('github.com/'))
                      yield* onCompletedText(threadId, text).pipe(
                        Effect.catchCause((cause) => Effect.logWarning(cause)),
                        Effect.forkIn(scope)
                      )
                  }
                }
                if (terminal) state(threadId).turnId = null
              })
            )
            .pipe(Effect.uninterruptible)
        )
      )
    }

    function appendUser(
      threadId: string,
      turnId: string,
      text: string,
      meta: Attachment[],
      onCommit: Effect.Effect<void>,
      queued?: QueuedMessage
    ) {
      return Effect.gen(function* () {
        const item = {
          id: newId(),
          turnId,
          createdAt: Date.now(),
          kind: 'user_message' as const,
          ...(queued ? { from: queued.from, hop: queued.hop } : {}),
          text,
          attachments: meta,
        }
        yield* state(threadId).publication.withPermit(
          hub
            .withChromePublication(
              Effect.gen(function* () {
                const appended = yield* store.transaction(
                  Effect.gen(function* () {
                    yield* store.beginDelivery(threadId, turnId, queued?.hop ?? 0, queued?.id)
                    return yield* store.appendEvents(threadId, [
                      { type: 'item.started', item },
                      { type: 'item.completed', itemId: item.id },
                    ])
                  })
                )
                yield* onCommit
                for (const event of appended) publish(threadId, event)
              })
            )
            .pipe(Effect.uninterruptible)
        )
      })
    }

    function maybeTitle(threadId: string, provider: AgentProvider, text: string) {
      if (!titler) return Effect.void
      return titler(provider, text).pipe(
        Effect.flatMap((title) =>
          hub.withChromePublication(
            Effect.gen(function* () {
              if (!title) return
              const updated = yield* store.setGeneratedTitle(threadId, title)
              if (!updated) return
              hub.pushChrome({ type: 'thread.upserted', thread: updated })
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

    function removeAttachments(meta: readonly Attachment[]) {
      return attachments
        ? Effect.forEach(meta, (attachment) => attachments.remove(attachment.id), {
            discard: true,
          })
        : Effect.void
    }

    function requireFound(what: string) {
      return (found: boolean) =>
        found ? Effect.void : Effect.fail(new StoreError('not_found', `No pending ${what}`))
    }

    function startTurnEffect(input: StartTurnInput) {
      return Effect.scoped(
        Effect.suspend(() =>
          state(input.threadId).admission.withPermit(
            Effect.gen(function* () {
              const thread = yield* store.requireThread(input.threadId)
              if (!input.queued || (input.sendNow && input.resumeQueue !== false))
                yield* store.setQueuePaused(input.threadId, false)
              if (input.queued) {
                if (
                  thread.archived ||
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
                const queued = thread.pendingMessages.find((m) => m.id === input.queued!.id)!
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
              if (input.text && (yield* store.needsGeneratedTitle(input.threadId)))
                yield* maybeTitle(input.threadId, chosen.provider, input.text)
              const live = state(input.threadId)
              if (live.turnId) {
                const turnId = live.turnId
                const accepted = yield* agent.steer(
                  input.threadId,
                  input.text,
                  saved.images,
                  appendUser(
                    input.threadId,
                    turnId,
                    input.text,
                    saved.meta,
                    onCommit,
                    input.queued
                  ).pipe(Effect.mapError(toAgentError))
                )
                if (!accepted) {
                  return yield* Effect.fail(
                    new StoreError('internal', 'Active turn is not accepting input')
                  )
                }
                return { turnId }
              }
              const turnId = newId()
              live.turnId = turnId
              live.ready = false
              const emit = (event: ThreadEvent, onCommit?: Effect.Effect<void>) =>
                append(input.threadId, event, onCommit).pipe(Effect.mapError(toAgentError))
              const turn = yield* appendUser(
                input.threadId,
                turnId,
                input.text,
                saved.meta,
                onCommit,
                input.queued
              ).pipe(
                Effect.andThen(
                  agent.startTurn(
                    {
                      threadId: input.threadId,
                      turnId,
                      text: input.text,
                      images: saved.images,
                      model: input.model,
                      effort: input.effort,
                      fast: input.fast,
                      permissionMode: input.permissionMode,
                    },
                    emit
                  )
                ),
                Effect.onError(() =>
                  append(input.threadId, {
                    type: 'turn.failed',
                    turnId,
                    error: 'Unable to start turn',
                  }).pipe(
                    Effect.ignore,
                    Effect.ensuring(
                      Effect.sync(() => {
                        if (live.turnId === turnId) live.turnId = null
                        live.ready = true
                      }).pipe(Effect.andThen(Queue.offer(store.queueChanges, undefined)))
                    )
                  )
                )
              )
              yield* turn.await.pipe(
                Effect.catch((error) =>
                  emit({ type: 'turn.failed', turnId, error: error.message })
                ),
                Effect.onInterrupt(() =>
                  emit({ type: 'turn.failed', turnId, error: 'server shutdown' }).pipe(
                    Effect.ignore
                  )
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    live.ready = true
                  }).pipe(Effect.andThen(Queue.offer(store.queueChanges, undefined)))
                ),
                Effect.forkIn(scope, { startImmediately: true })
              )
              return { turnId }
            })
          )
        )
      )
    }

    return {
      withPublication<A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) {
        return Effect.suspend(() => state(threadId).publication.withPermit(effect))
      },
      startTurnEffect,
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
          const saved = attachments ? yield* attachments.persist(uploads) : EMPTY_ATTACHMENTS
          yield* hub
            .withChromePublication(
              store
                .enqueue(threadId, {
                  id: messageId,
                  text,
                  createdAt: Date.now(),
                  hop: 0,
                  ...(saved.meta.length ? { attachments: saved.meta } : {}),
                })
                .pipe(
                  Effect.tap((thread) =>
                    Effect.sync(() => hub.pushChrome({ type: 'thread.upserted', thread }))
                  ),
                  Effect.uninterruptible
                )
            )
            .pipe(Effect.onError(() => removeAttachments(saved.meta)))
        })
      },
      editQueued(threadId: string, messageId: string, text?: string) {
        return state(threadId).admission.withPermit(
          hub.withChromePublication(
            Effect.gen(function* () {
              const before = yield* store.requireThread(threadId)
              const thread = yield* store.editQueued(threadId, messageId, text)
              hub.pushChrome({ type: 'thread.upserted', thread })
              if (text === undefined)
                yield* removeAttachments(
                  before.pendingMessages?.find((m) => m.id === messageId)?.attachments ?? []
                )
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
        const drain = Effect.gen(function* () {
          for (const thread of yield* store.listThreads()) {
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
              (yield* store.isQueuePaused(thread.id)) ||
              state(thread.id).turnId ||
              !state(thread.id).ready ||
              !queue[0] ||
              (queue[0].editingUntil ?? 0) > Date.now()
            )
              continue
            yield* startTurnEffect({
              threadId: thread.id,
              text: queue[0].text,
              queued: queue[0],
            }).pipe(
              Effect.catchCause((cause) =>
                hub
                  .withChromePublication(
                    store
                      .transaction(
                        Effect.gen(function* () {
                          const current = yield* store.getThread(thread.id)
                          if (!current?.pendingMessages?.some((m) => m.id === queue[0]!.id)) return
                          yield* store.editQueued(thread.id, queue[0]!.id)
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
                      .pipe(
                        Effect.tap((appended) =>
                          Effect.sync(() => {
                            if (appended) publish(thread.id, appended)
                          })
                        )
                      )
                  )
                  .pipe(Effect.catchCause((failure) => Effect.logError(failure)))
              )
            )
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
      interrupt(threadId: string) {
        return agentForThread(threadId).pipe(
          Effect.flatMap((agent) =>
            store.setQueuePaused(threadId, true).pipe(Effect.andThen(agent.interrupt(threadId)))
          )
        )
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
            yield* agent.steer(threadId, `User's note on the denied approval: ${message.trim()}`)
        })
      },
      respondQuestion(threadId: string, itemId: string, answers: Record<string, string> | null) {
        return agentForThread(threadId).pipe(
          Effect.flatMap((agent) => agent.respondToQuestion(threadId, itemId, answers)),
          Effect.flatMap(requireFound(`question ${itemId}`))
        )
      },
      deleteThread(threadId: string) {
        return Effect.suspend(() => {
          const live = state(threadId)
          // Same lock order as a turn's writes: admission, publication, chrome.
          return live.admission.withPermit(
            live.publication.withPermit(
              hub.withChromePublication(
                Effect.gen(function* () {
                  yield* store.requireThread(threadId)
                  // A persisted activeTurnId can outlive a crash; only a live turn blocks delete.
                  if (live.turnId)
                    return yield* Effect.fail(
                      new StoreError('conflict', 'Cannot delete a thread while a turn is running')
                    )
                  const attachmentIds = yield* store.deleteThread(threadId)
                  if (attachments)
                    yield* Effect.forEach(attachmentIds, (id) => attachments.remove(id), {
                      discard: true,
                    })
                  hub.pushChrome({ type: 'thread.removed', threadId })
                }).pipe(Effect.uninterruptible)
              )
            )
          )
        })
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

export function orchestratorLayer(
  store: Store,
  hub: Hub,
  titler: ProviderTitler | null,
  attachments: Attachments,
  registry: AgentRegistry,
  onCompletedText?: (threadId: string, text: string) => Effect.Effect<void>,
  reviewer?: ReviewClassifier
) {
  return Layer.effect(
    OrchestratorService,
    createOrchestrator(store, registry, hub, titler, attachments, onCompletedText, reviewer)
  )
}

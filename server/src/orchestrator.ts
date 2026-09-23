import type { ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, Attachment } from '@jetty/shared/items'
import type { EffortLevel, PermissionMode, UploadAttachment } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Context, Effect, Layer, Semaphore } from 'effect'

import type { Attachments, PersistedAttachments } from './attachments'
import type { Hub } from './hub'
import type { AppendedEvent, Store } from './store'
import type { Titler } from './titler'

import { AgentError, AgentService, type Agent } from './agent'
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
  permissionMode?: PermissionMode
}

export function createOrchestrator(
  store: Store,
  agent: Agent,
  hub: Hub,
  titler: Titler | null = null,
  attachments: Attachments | null = null
) {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    const threads = new Map<
      string,
      { admission: Semaphore.Semaphore; publication: Semaphore.Semaphore; turnId: string | null }
    >()

    function state(threadId: string) {
      let value = threads.get(threadId)
      if (!value) {
        value = {
          admission: Semaphore.makeUnsafe(1),
          publication: Semaphore.makeUnsafe(1),
          turnId: null,
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

    function append(threadId: string, event: ThreadEvent, onCommit = Effect.void) {
      return Effect.suspend(() =>
        state(threadId).publication.withPermit(
          hub
            .withChromePublication(
              Effect.gen(function* () {
                const terminal = event.type === 'turn.completed' || event.type === 'turn.failed'
                if (terminal && state(threadId).turnId !== event.turnId) return
                const appended = yield* store.appendEvent(threadId, event)
                yield* onCommit
                publish(threadId, appended)
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
      onCommit: Effect.Effect<void>
    ) {
      return Effect.gen(function* () {
        const item = {
          id: newId(),
          turnId,
          createdAt: Date.now(),
          kind: 'user_message' as const,
          text,
          attachments: meta,
        }
        yield* state(threadId).publication.withPermit(
          hub
            .withChromePublication(
              Effect.gen(function* () {
                const appended = yield* store.appendEvents(threadId, [
                  { type: 'item.started', item },
                  { type: 'item.completed', itemId: item.id },
                ])
                yield* onCommit
                for (const event of appended) publish(threadId, event)
              })
            )
            .pipe(Effect.uninterruptible)
        )
      })
    }

    function checkThread(threadId: string) {
      return Effect.gen(function* () {
        const thread = yield* store.getThread(threadId)
        if (!thread)
          return yield* Effect.fail(new StoreError('not_found', `Thread ${threadId} not found`))
        return thread
      })
    }

    function maybeTitle(threadId: string, text: string) {
      if (!titler) return Effect.void
      return titler(text).pipe(
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

    function startTurnEffect(input: StartTurnInput) {
      return Effect.scoped(
        Effect.suspend(() =>
          state(input.threadId).admission.withPermit(
            Effect.gen(function* () {
              yield* checkThread(input.threadId)
              let committed = false
              const onCommit = Effect.sync(() => {
                committed = true
              })
              const saved = attachments
                ? yield* Effect.acquireRelease(
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
                : EMPTY_ATTACHMENTS
              if (yield* store.needsGeneratedTitle(input.threadId))
                yield* maybeTitle(input.threadId, input.text)
              const live = state(input.threadId)
              if (live.turnId) {
                const existing = live.turnId
                if (
                  yield* agent.steer(
                    input.threadId,
                    input.text,
                    saved.images,
                    appendUser(input.threadId, existing, input.text, saved.meta, onCommit).pipe(
                      Effect.mapError((error) => new AgentError(error.message))
                    )
                  )
                ) {
                  return { turnId: existing }
                }
                return yield* Effect.fail(
                  new StoreError('internal', 'Active turn is not accepting input')
                )
              }
              const turnId = newId()
              live.turnId = turnId
              const emit = (event: ThreadEvent, onCommit?: Effect.Effect<void>) =>
                append(input.threadId, event, onCommit).pipe(
                  Effect.mapError((error) => new AgentError(error.message))
                )
              const turn = yield* appendUser(
                input.threadId,
                turnId,
                input.text,
                saved.meta,
                onCommit
              ).pipe(
                Effect.andThen(agent.startTurn({ ...input, turnId, images: saved.images }, emit)),
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
                      })
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
      interrupt(threadId: string) {
        return checkThread(threadId).pipe(Effect.andThen(agent.interrupt(threadId)))
      },
      respondApproval(
        threadId: string,
        itemId: string,
        decision: ApprovalDecision,
        message?: string,
        updatedPermissions?: unknown[]
      ) {
        return checkThread(threadId).pipe(
          Effect.andThen(
            agent.respondToApproval(threadId, itemId, decision, message, updatedPermissions)
          ),
          Effect.flatMap((found) =>
            found
              ? Effect.void
              : Effect.fail(new StoreError('not_found', `No pending approval ${itemId}`))
          )
        )
      },
      respondQuestion(threadId: string, itemId: string, answers: Record<string, string>) {
        return checkThread(threadId).pipe(
          Effect.andThen(agent.respondToQuestion(threadId, itemId, answers)),
          Effect.flatMap((found) =>
            found
              ? Effect.void
              : Effect.fail(new StoreError('not_found', `No pending question ${itemId}`))
          )
        )
      },
      deleteThread(threadId: string) {
        return Effect.suspend(() => {
          const live = state(threadId)
          // admission, then publication, then chrome — same order as a turn's writes.
          return live.admission.withPermit(
            live.publication.withPermit(
              hub.withChromePublication(
                Effect.gen(function* () {
                  const thread = yield* store.getThread(threadId)
                  if (!thread)
                    return yield* Effect.fail(
                      new StoreError('not_found', `Thread ${threadId} not found`)
                    )
                  // turnId is the live writer. Persisted activeTurnId survives a crash
                  // with no agent left, so it must not block delete.
                  if (live.turnId)
                    return yield* Effect.fail(
                      new StoreError('conflict', 'Cannot delete a thread while a turn is running')
                    )
                  const attachmentIds = yield* store.deleteThread(threadId)
                  const files = attachments
                  if (files)
                    yield* Effect.forEach(attachmentIds, (id) => files.remove(id), {
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
  titler: Titler | null,
  attachments: Attachments
) {
  return Layer.effect(
    OrchestratorService,
    Effect.gen(function* () {
      return yield* createOrchestrator(store, yield* AgentService, hub, titler, attachments)
    })
  )
}

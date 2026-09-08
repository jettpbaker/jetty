import type { ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, Attachment } from '@jetty/shared/items'
import type { EffortLevel, PermissionMode, UploadAttachment } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Context, Effect, Layer, Semaphore } from 'effect'

import type { Attachments, PersistedAttachments } from './attachments'
import type { Hub } from './hub'
import type { Store } from './store'
import type { Titler } from './titler'

import { AgentError, AgentService, type Agent } from './agent'
import { DEFAULT_THREAD_TITLE, StoreError } from './store'

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

export function storeEffect<A>(read: () => A) {
  return Effect.try({
    try: read,
    catch: (error) =>
      error instanceof StoreError ? error : new StoreError('internal', String(error)),
  })
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

    function append(threadId: string, event: ThreadEvent) {
      return Effect.suspend(() =>
        state(threadId).publication.withPermit(
          storeEffect(() => {
            const terminal = event.type === 'turn.completed' || event.type === 'turn.failed'
            if (terminal && state(threadId).turnId !== event.turnId) return
            const appended = store.appendEvent(threadId, event)
            hub.pushThread(threadId, {
              sub: 'thread',
              threadId,
              seq: appended.seq,
              ts: appended.ts,
              event: appended.event,
            })
            if (appended.state.status !== appended.prevStatus) {
              const thread = store.getThread(threadId)
              if (thread) hub.pushChrome({ type: 'thread.upserted', thread })
            }
            if (terminal) state(threadId).turnId = null
          })
        )
      )
    }

    function appendUser(threadId: string, turnId: string, text: string, meta: Attachment[]) {
      return Effect.gen(function* () {
        const item = {
          id: newId(),
          turnId,
          createdAt: Date.now(),
          kind: 'user_message' as const,
          text,
          attachments: meta,
        }
        yield* append(threadId, { type: 'item.started', item })
        yield* append(threadId, { type: 'item.completed', itemId: item.id })
      })
    }

    function checkThread(threadId: string) {
      return storeEffect(() => {
        const thread = store.getThread(threadId)
        if (!thread) throw new StoreError('not_found', `Thread ${threadId} not found`)
        return thread
      })
    }

    function maybeTitle(threadId: string, text: string) {
      if (!titler) return Effect.void
      return titler(text).pipe(
        Effect.flatMap((title) =>
          storeEffect(() => {
            if (!title) return
            const current = store.getThread(threadId)
            if (!current || current.title !== DEFAULT_THREAD_TITLE) return
            hub.pushChrome({
              type: 'thread.upserted',
              thread: store.setThreadTitle(threadId, title),
            })
          })
        ),
        Effect.ignore,
        Effect.forkIn(scope),
        Effect.asVoid
      )
    }

    function startTurnEffect(input: StartTurnInput) {
      return Effect.suspend(() =>
        state(input.threadId).admission.withPermit(
          Effect.gen(function* () {
            const thread = yield* checkThread(input.threadId)
            const saved = attachments
              ? yield* storeEffect(() => attachments.persist(input.attachments))
              : EMPTY_ATTACHMENTS
            if (thread.title === DEFAULT_THREAD_TITLE) yield* maybeTitle(input.threadId, input.text)
            const live = state(input.threadId)
            if (live.turnId) {
              const existing = live.turnId
              if (yield* agent.steer(input.threadId, input.text, saved.images)) {
                yield* appendUser(input.threadId, existing, input.text, saved.meta)
                return { turnId: existing }
              }
              return yield* Effect.fail(
                new StoreError('internal', 'Active turn is not accepting input')
              )
            }
            const turnId = newId()
            live.turnId = turnId
            const emit = (event: ThreadEvent) =>
              append(input.threadId, event).pipe(
                Effect.mapError((error) => new AgentError(error.message))
              )
            const turn = yield* appendUser(input.threadId, turnId, input.text, saved.meta).pipe(
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
              Effect.catch((error) => emit({ type: 'turn.failed', turnId, error: error.message })),
              Effect.onInterrupt(() =>
                emit({ type: 'turn.failed', turnId, error: 'server shutdown' }).pipe(Effect.ignore)
              ),
              Effect.forkIn(scope, { startImmediately: true })
            )
            return { turnId }
          }).pipe(Effect.uninterruptible)
        )
      )
    }

    return {
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
      isActive(threadId: string) {
        return storeEffect(
          () => !!state(threadId).turnId || store.getThreadState(threadId).activeTurnId !== null
        )
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

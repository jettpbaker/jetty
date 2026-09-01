import type { ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, Attachment, ThreadItem } from '@jetty/shared/items'
import type { EffortLevel, PermissionMode, UploadAttachment } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Effect } from 'effect'

import type { Agent } from './agent'
import type { Attachments, PersistedAttachments } from './attachments'
import type { Hub } from './hub'
import type { AppendedEvent, Store } from './store'
import type { Titler } from './titler'

import { DEFAULT_THREAD_TITLE, StoreError } from './store'

const EMPTY_ATTACHMENTS: PersistedAttachments = { meta: [], images: [] }

export type Orchestrator = ReturnType<typeof createOrchestrator>

export type StartTurnInput = {
  threadId: string
  text: string
  attachments?: UploadAttachment[]
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
  /** In-flight agent turns (may lead store.activeTurnId briefly before turn.started). */
  const liveTurns = new Map<string, string>()

  function publish(threadId: string, appended: AppendedEvent) {
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
  }

  function append(threadId: string, event: ThreadEvent): AppendedEvent {
    const appended = store.appendEvent(threadId, event)
    publish(threadId, appended)
    return appended
  }

  function emitFor(threadId: string) {
    return (event: ThreadEvent) => {
      append(threadId, event)
    }
  }

  function appendUserMessage(threadId: string, turnId: string, text: string, meta: Attachment[]) {
    const item: ThreadItem = {
      id: newId(),
      turnId,
      createdAt: Date.now(),
      kind: 'user_message',
      text,
      attachments: meta,
    }
    append(threadId, { type: 'item.started', item })
    append(threadId, { type: 'item.completed', itemId: item.id })
  }

  function activeTurnId(threadId: string): string | null {
    return liveTurns.get(threadId) ?? store.getThreadState(threadId).activeTurnId
  }

  /** Fire-and-forget: never on the turn's critical path. */
  function maybeTitle(threadId: string, text: string) {
    if (!titler) return
    void (async () => {
      try {
        const title = await titler(text)
        if (!title) return
        const current = store.getThread(threadId)
        if (!current || current.title !== DEFAULT_THREAD_TITLE) return
        const updated = store.setThreadTitle(threadId, title)
        hub.pushChrome({ type: 'thread.upserted', thread: updated })
      } catch {
        // titling must never break a turn
      }
    })()
  }

  const startTurnEffect = (input: StartTurnInput) =>
    Effect.gen(function* () {
      const thread = yield* Effect.try(() => store.getThread(input.threadId))

      if (!thread) {
        return yield* Effect.fail(new StoreError('not_found', `Thread ${input.threadId} not found`))
      }

      const saved = attachments
        ? yield* Effect.try({
            try: () => attachments.persist(input.attachments),
            catch: (error) => error,
          })
        : EMPTY_ATTACHMENTS

      if (thread.title === DEFAULT_THREAD_TITLE) maybeTitle(input.threadId, input.text)

      const existingTurnId = yield* Effect.try(() => activeTurnId(input.threadId))
      if (existingTurnId) {
        const steered = yield* Effect.try(() =>
          agent.steer(input.threadId, input.text, saved.images)
        )

        if (steered) {
          yield* Effect.logInfo('steer').pipe(Effect.annotateLogs('turnId', existingTurnId))

          yield* Effect.try({
            try: () => appendUserMessage(input.threadId, existingTurnId, input.text, saved.meta),
            catch: (error) => error,
          })
          return { turnId: existingTurnId }
        }
      }

      const turnId = newId()
      yield* Effect.logInfo('fresh turn').pipe(Effect.annotateLogs('turnId', turnId))

      liveTurns.set(input.threadId, turnId)

      yield* Effect.try({
        try: () => appendUserMessage(input.threadId, turnId, input.text, saved.meta),
        catch: (error) => error,
      }).pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            liveTurns.delete(input.threadId)
          })
        )
      )

      const agentLifecycle = Effect.tryPromise({
        try: () =>
          agent.startTurn(
            {
              threadId: input.threadId,
              turnId,
              text: input.text,
              images: saved.images,
              model: input.model,
              effort: input.effort,
              permissionMode: input.permissionMode,
            },
            emitFor(input.threadId)
          ),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const message = error instanceof Error ? error.message : String(error)

            yield* Effect.logError('startTurn failed').pipe(
              Effect.annotateLogs({ turnId: turnId, error: message })
            )

            yield* Effect.try(() =>
              append(input.threadId, { type: 'turn.failed', turnId, error: message })
            ).pipe(Effect.ignore)
          })
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (liveTurns.get(input.threadId) === turnId) {
              liveTurns.delete(input.threadId)
            }
          })
        )
      )

      yield* agentLifecycle.pipe(Effect.forkDetach({ startImmediately: true }))

      return { turnId }
    }).pipe(
      Effect.annotateLogs({
        area: 'orch',
        threadId: input.threadId,
      }),
      Effect.withLogSpan('startTurn')
    )

  return {
    startTurnEffect,

    interrupt(threadId: string) {
      if (!store.getThread(threadId)) {
        throw new StoreError('not_found', `Thread ${threadId} not found`)
      }
      agent.interrupt(threadId)
    },

    respondApproval(
      threadId: string,
      itemId: string,
      decision: ApprovalDecision,
      message?: string,
      updatedPermissions?: unknown[]
    ) {
      if (!store.getThread(threadId)) {
        throw new StoreError('not_found', `Thread ${threadId} not found`)
      }
      if (!agent.respondToApproval(threadId, itemId, decision, message, updatedPermissions)) {
        throw new StoreError('not_found', `No pending approval ${itemId}`)
      }
    },

    respondQuestion(threadId: string, itemId: string, answers: Record<string, string>) {
      if (!store.getThread(threadId)) {
        throw new StoreError('not_found', `Thread ${threadId} not found`)
      }
      if (!agent.respondToQuestion(threadId, itemId, answers)) {
        throw new StoreError('not_found', `No pending question ${itemId}`)
      }
    },

    isActive(threadId: string) {
      return liveTurns.has(threadId) || store.getThreadState(threadId).activeTurnId !== null
    },
  }
}

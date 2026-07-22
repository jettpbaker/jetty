import type { ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, Attachment, ThreadItem } from '@jetty/shared/items'
import type { EffortLevel, PermissionMode, UploadAttachment } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'

import type { Agent } from './agent'
import type { Attachments, PersistedAttachments } from './attachments'
import type { Hub } from './hub'
import type { AppendedEvent, Store } from './store'
import type { Titler } from './titler'

import { slog } from './log'
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

  return {
    async startTurn(input: StartTurnInput): Promise<{ turnId: string }> {
      const thread = store.getThread(input.threadId)
      if (!thread) throw new StoreError('not_found', `Thread ${input.threadId} not found`)

      // Persist before any item/turn is recorded so a bad upload leaves nothing behind.
      const saved = attachments ? attachments.persist(input.attachments) : EMPTY_ATTACHMENTS

      if (thread.title === DEFAULT_THREAD_TITLE) {
        maybeTitle(input.threadId, input.text)
      }

      const existingTurnId = activeTurnId(input.threadId)
      if (existingTurnId && agent.steer(input.threadId, input.text, saved.images)) {
        slog('orch', `steer thread=${input.threadId} turn=${existingTurnId}`)
        appendUserMessage(input.threadId, existingTurnId, input.text, saved.meta)
        return { turnId: existingTurnId }
      }
      // No active turn, or the warm session vanished mid-race — fresh turn.

      const turnId = newId()
      slog('orch', `fresh turn thread=${input.threadId} turn=${turnId}`)
      liveTurns.set(input.threadId, turnId)

      try {
        appendUserMessage(input.threadId, turnId, input.text, saved.meta)

        void agent
          .startTurn(
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
          )
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            slog('orch', `startTurn failed thread=${input.threadId} turn=${turnId}: ${message}`)
            try {
              append(input.threadId, { type: 'turn.failed', turnId, error: message })
            } catch {
              // thread may have disappeared mid-turn
            }
          })
          .finally(() => {
            if (liveTurns.get(input.threadId) === turnId) {
              liveTurns.delete(input.threadId)
            }
          })
      } catch (err) {
        liveTurns.delete(input.threadId)
        throw err
      }

      return { turnId }
    },

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

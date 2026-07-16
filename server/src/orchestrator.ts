import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import { newId } from '@jetty/shared/wire'

import type { Agent } from './agent'
import type { Hub } from './hub'
import type { AppendedEvent, Store } from './store'

import { StoreError } from './store'

export type Orchestrator = ReturnType<typeof createOrchestrator>

export function createOrchestrator(store: Store, agent: Agent, hub: Hub) {
  const active = new Set<string>()

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

  return {
    async startTurn(input: { threadId: string; text: string }): Promise<{ turnId: string }> {
      const thread = store.getThread(input.threadId)
      if (!thread) throw new StoreError('not_found', `Thread ${input.threadId} not found`)
      if (active.has(input.threadId)) {
        throw new StoreError('turn_active', 'A turn is already running on this thread')
      }

      const turnId = newId()
      active.add(input.threadId)

      try {
        const userItem: ThreadItem = {
          id: newId(),
          turnId,
          createdAt: Date.now(),
          kind: 'user_message',
          text: input.text,
          attachments: [],
        }
        append(input.threadId, { type: 'item.started', item: userItem })
        append(input.threadId, { type: 'item.completed', itemId: userItem.id })

        void agent
          .startTurn(
            { threadId: input.threadId, turnId, text: input.text },
            emitFor(input.threadId)
          )
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            try {
              append(input.threadId, { type: 'turn.failed', turnId, error: message })
            } catch {
              // thread may have disappeared mid-turn
            }
          })
          .finally(() => {
            active.delete(input.threadId)
          })
      } catch (err) {
        active.delete(input.threadId)
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

    isActive(threadId: string) {
      return active.has(threadId)
    },
  }
}

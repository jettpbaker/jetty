import type { UploadAttachment } from '@jetty/shared/wire'

import { socket, timelineStore } from '@/app-state'
import { clearDraft } from '@/lib/draft'
import { toast } from 'sonner'

/** A first turn in flight: the thread doesn't exist on the server yet. */
export type PendingSend = {
  text: string
  projectId: string
  attachments: UploadAttachment[]
  phase: 'sending' | 'failed'
}

function createPendingSends() {
  const map = new Map<string, PendingSend>()
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get(threadId: string) {
      return map.get(threadId)
    },
    set(threadId: string, value: PendingSend) {
      map.set(threadId, value)
      emit()
    },
    clear(threadId: string) {
      if (map.delete(threadId)) emit()
    },
  }
}

export const pendingSends = createPendingSends()

/**
 * Drives the draft→thread transition, running behind the immediate navigation:
 * create the thread, subscribe now that it exists, then start the first turn.
 * The pending entry keeps the submitted text visible in the thread composer
 * until turn.start confirms — our anti-vanish stand-in for an optimistic item.
 * Rejects on failure so a retry through the composer keeps the text.
 */
export async function sendFirstTurn({
  threadId,
  projectId,
  text,
  attachments,
}: {
  threadId: string
  projectId: string
  text: string
  attachments: UploadAttachment[]
}) {
  pendingSends.set(threadId, { text, projectId, attachments, phase: 'sending' })
  try {
    await socket.request('thread.create', { id: threadId, projectId })
    timelineStore.openThread(threadId)
    await socket.request('turn.start', { threadId, text, attachments })
    pendingSends.clear(threadId)
    clearDraft(projectId)
  } catch (error) {
    pendingSends.set(threadId, { text, projectId, attachments, phase: 'failed' })
    toast.error('Couldn’t start the thread. Press send to retry.')
    throw error
  }
}

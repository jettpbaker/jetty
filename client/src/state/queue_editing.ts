import type { QueuedMessage } from '@jetty/shared/wire'

export function isQueuedEditing(entry: QueuedMessage, editing?: string) {
  return entry.id === editing || (entry.editingUntil ?? 0) > Date.now()
}

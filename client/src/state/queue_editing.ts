import type { QueuedMessage } from '@jetty/shared/wire'

import { serverNow } from '../lib/server_time'

export function isQueuedEditing(entry: QueuedMessage, editing?: string) {
  return entry.id === editing || (entry.editingUntil ?? 0) > serverNow()
}

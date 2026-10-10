import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadState } from '@jetty/shared/reducer'

import { foldUpdate, noteCompleted } from '@/state'

export function landReplayEvent(
  state: ThreadState,
  event: ThreadEvent,
  seq: number,
  ts = Date.now()
) {
  if (event.type === 'item.completed') noteCompleted(event.itemId)
  return foldUpdate(state, {
    type: 'event',
    seq,
    ts,
    event:
      event.type === 'item.started' ? { ...event, item: { ...event.item, createdAt: ts } } : event,
  })
}

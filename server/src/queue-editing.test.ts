import type { QueuedMessage } from '@jetty/shared/wire'

import { expect, test } from 'bun:test'

import { isQueuedEditing } from '../../client/src/state/queue_editing'

const message: QueuedMessage = { id: 'head', text: 'head', createdAt: 0, hop: 0 }

test('an edit held by another tab counts without a local editing draft', () => {
  expect(isQueuedEditing({ ...message, editingUntil: Date.now() + 60_000 })).toBe(true)
  expect(isQueuedEditing({ ...message, editingUntil: Date.now() - 1 })).toBe(false)
  expect(isQueuedEditing(message)).toBe(false)
})

test('the local editing draft still holds a message before the server hold arrives', () => {
  expect(isQueuedEditing(message, 'head')).toBe(true)
  expect(isQueuedEditing({ ...message, editingUntil: Date.now() - 1 }, 'head')).toBe(true)
  expect(isQueuedEditing(message, 'other')).toBe(false)
})

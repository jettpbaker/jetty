import type { ThreadEvent } from '@jetty/shared/events'

import { WAIT_NOTES } from '@jetty/shared/bots'
import { RESTART_LIMIT_NOTE } from '@jetty/shared/items'
import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Store } from './store'

import { createChildWaits } from './quiet-threads'
import { openTestStore } from './store-fixture'

const triggers: Record<string, (store: Store, id: string) => Effect.Effect<unknown, Error>> = {
  status: (store, id) =>
    store.appendEvent(id, { type: 'session.status', status: 'awaiting_approval' }),
  question: (store, id) =>
    store.appendEvent(id, {
      type: 'item.started',
      item: { id: newId(), turnId: 'turn', createdAt: Date.now(), kind: 'question', questions: [] },
    }),
  approval: (store, id) =>
    store.appendEvent(id, {
      type: 'item.started',
      item: {
        id: newId(),
        turnId: 'turn',
        createdAt: Date.now(),
        kind: 'approval',
        title: 'Push',
        toolName: 'Bash',
        input: {},
        suggestions: [],
      },
    }),
  failure: (store, id) =>
    store.appendEvent(id, { type: 'turn.failed', turnId: 'turn', error: 'failed' }),
  restart: (store, id) =>
    store.appendEvent(id, {
      type: 'item.started',
      item: {
        id: newId(),
        turnId: 'turn',
        createdAt: Date.now(),
        kind: 'error',
        message: RESTART_LIMIT_NOTE,
      },
    }),
  setup: (store, id) =>
    store.saveWorktree(id, {
      checkoutPath: null,
      baseCommit: 'base',
      branch: null,
      temporaryBranch: null,
      slot: null,
      state: 'failed',
      error: 'setup failed',
    }),
  pullRequest: (store, id) => store.linkPullRequest(id, 'test/repo', 1),
  pin: (store, id) => store.pinThread(id, true),
  seen: (store, id) => store.markThreadSeen(id),
}

test('a quiet wait finishes after a queued message from another thread', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jetty-quiet-'))
  const { store, close } = await openTestStore(home)
  try {
    const project = await Effect.runPromise(store.createProject(home))
    const parent = await Effect.runPromise(store.createThread(project.id, newId()))
    const other = await Effect.runPromise(store.createThread(project.id, newId()))
    const child = await Effect.runPromise(store.createThread(project.id, newId()))
    await Effect.runPromise(store.markAgentThread(child.id, parent.id, true))
    await Effect.runPromise(store.setQuietThread(child.id, true, null))
    for (const sender of [parent, other]) {
      const messageId = newId()
      const turnId = newId()
      await Effect.runPromise(
        store.enqueue(child.id, {
          id: messageId,
          text: 'Read the config.',
          from: { threadId: sender.id, title: sender.title },
          createdAt: Date.now(),
          hop: 1,
        })
      )
      await Effect.runPromise(store.beginDelivery(child.id, turnId, 1, messageId))
      await Effect.runPromise(store.appendEvent(child.id, { type: 'turn.started', turnId }))
      await Effect.runPromise(
        store.appendEvent(child.id, {
          type: 'item.started',
          item: {
            id: newId(),
            turnId,
            createdAt: Date.now(),
            kind: 'assistant_message',
            text: sender.id === parent.id ? 'Port is 4322.' : 'Retry limit is 3.',
          },
        })
      )
      await Effect.runPromise(store.appendEvent(child.id, { type: 'turn.completed', turnId }))
    }
    expect(await Effect.runPromise(store.reportSettledChild(child.id))).toEqual({
      delivered: false,
    })
    expect(await Effect.runPromise(store.reportSettledChild(child.id, { wait: true }))).toMatchObject({
      waited: { status: 'finished', report: 'Retry limit is 3.' },
    })
  } finally {
    await close()
    rmSync(home, { recursive: true, force: true })
  }
})

for (const [name, trigger] of Object.entries(triggers)) {
  test(`${name} surfaces a quiet thread permanently`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'jetty-quiet-'))
    const { store, close } = await openTestStore(home)
    try {
      const project = await Effect.runPromise(store.createProject(home))
      const thread = await Effect.runPromise(store.createThread(project.id, newId()))
      await Effect.runPromise(store.setQuietThread(thread.id, true, null))
      await Effect.runPromise(
        store.appendEvent(thread.id, { type: 'turn.started', turnId: 'turn' })
      )
      expect((await Effect.runPromise(store.requireThread(thread.id))).quiet).toBe(true)
      await Effect.runPromise(trigger(store, thread.id))
      expect((await Effect.runPromise(store.requireThread(thread.id))).quiet).toBeUndefined()
      const events: ThreadEvent[] = [
        { type: 'turn.completed', turnId: 'turn' },
        { type: 'turn.started', turnId: 'next' },
        { type: 'turn.completed', turnId: 'next' },
      ]
      for (const event of events) await Effect.runPromise(store.appendEvent(thread.id, event))
      await Effect.runPromise(store.pinThread(thread.id, false))
      const final = await Effect.runPromise(store.requireThread(thread.id))
      expect(final.quiet).toBeUndefined()
      expect(final.readOnly).toBe(true)
    } finally {
      await close()
      rmSync(home, { recursive: true, force: true })
    }
  })
}

test('a wait past its injected cap returns the exact running note', async () => {
  const waits = createChildWaits()
  const result = await waits.wait('child', 'bot', 5, new AbortController().signal)
  expect(result).toEqual({ status: 'running', detail: WAIT_NOTES.running })
  expect(waits.has('child')).toBe(false)
})

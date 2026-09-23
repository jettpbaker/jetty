import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startServer } from './main'
import { connect } from './rpc-test-client'
import { openTestStore } from './store-fixture'

test('Codex fixture over backend RPC: disconnect, durable completion, immediate next turn, and approval', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jetty-codex-rpc-'))
  const server = await startServer({
    home,
    port: 0,
    agent: 'codex',
    titler: null,
    codex: {
      command: process.execPath,
      args: [join(import.meta.dir, 'fixtures/codex-peer.ts')],
      requestTimeoutMs: 1000,
    },
  })
  let client = await connect(server.port)
  try {
    const { project } = await client.request('project.create', { path: home })
    const threadId = newId()
    await client.request('thread.create', { id: threadId, projectId: project.id })
    let subscription = client.subscribeThread({ threadId })
    await subscription.ready
    await client.request('turn.start', { threadId, text: 'hold' })
    await subscription.waitFor(
      (message) =>
        message.type === 'event' &&
        message.event.type === 'item.started' &&
        message.event.item.kind === 'assistant_message'
    )
    await client.close()
    expect((await Effect.runPromise(server.store.getThreadState(threadId))).status).toBe('running')
    client = await connect(server.port)
    subscription = client.subscribeThread({ threadId })
    await subscription.ready
    const steered = await client.request('turn.start', { threadId, text: 'steered' })
    await subscription.waitFor(
      (message) => message.type === 'event' && message.event.type === 'turn.completed'
    )
    const next = await client.request('turn.start', { threadId, text: 'approval' })
    expect(next.turnId).not.toBe(steered.turnId)
    const approval = await subscription.waitFor(
      (message) =>
        message.type === 'event' &&
        message.event.type === 'item.started' &&
        message.event.item.kind === 'approval'
    )
    if (approval.type !== 'event' || approval.event.type !== 'item.started')
      throw new Error('Missing approval')
    await client.request('approval.respond', {
      threadId,
      itemId: approval.event.item.id,
      decision: 'deny',
    })
    await subscription.waitFor(
      (message) =>
        message.type === 'event' &&
        message.event.type === 'turn.completed' &&
        message.event.turnId === next.turnId
    )
    const state = await Effect.runPromise(server.store.getThreadState(threadId))
    expect(state.status).toBe('idle')
    expect(state.items.filter((item) => item.kind === 'user_message')).toHaveLength(3)
    expect(state.items.find((item) => item.kind === 'approval')).toMatchObject({ decision: 'deny' })
    expect(await Effect.runPromise(server.store.getThreadSessionId(threadId))).toBeNull()
    const active = await client.request('turn.start', { threadId, text: 'hold' })
    await subscription.waitFor(
      (message) =>
        message.type === 'event' &&
        message.event.type === 'item.started' &&
        message.event.item.turnId === active.turnId &&
        message.event.item.kind === 'assistant_message'
    )
    await server.stop()
    const reopened = await openTestStore(home)
    try {
      const stopped = await Effect.runPromise(reopened.store.getThreadState(threadId))
      expect(stopped.status).toBe('idle')
      expect(stopped.activeTurnId).toBeNull()
      const events = await Effect.runPromise(reopened.store.getEventsAfter(threadId, state.lastSeq))
      expect(events.filter((event) => event.event.type === 'turn.failed')).toHaveLength(1)
    } finally {
      await reopened.close()
    }
  } finally {
    await client.close()
    await server.stop()
    rmSync(home, { recursive: true, force: true })
  }
})

import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startServer } from './main'
import { connect } from './rpc-test-client'

// Uses the CLI's existing login. Never enabled by ordinary `bun test`.
test.skipIf(process.env.JETTY_GROK_LIVE_TEST !== '1')(
  'live Grok backend RPC: tool use, streamed reply, restart and conversation resume',
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'jetty-grok-live-'))
    const marker = `JETTY-${newId()}`
    writeFileSync(join(home, 'marker.txt'), marker)
    let server = await startServer({ home, port: 0, agent: 'grok', titler: null })
    let client = await connect(server.port)
    try {
      const project = await client.request('project.create', { path: home })
      const threadId = newId()
      await client.request('thread.create', { id: threadId, projectId: project.project.id })
      const subscription = client.subscribeThread({ threadId })
      await subscription.ready
      const first = await client.request('turn.start', {
        threadId,
        text: 'Read marker.txt using a shell tool. Reply with only its exact contents. Do not write files or use network tools.',
        model: process.env.JETTY_GROK_MODEL ?? 'grok-build',
        permissionMode: 'auto',
      })
      const terminal = await subscription.waitFor(
        (message) =>
          message.type === 'event' &&
          (message.event.type === 'turn.completed' || message.event.type === 'turn.failed'),
        120_000
      )
      expect(terminal).toMatchObject({
        type: 'event',
        event: { type: 'turn.completed', turnId: first.turnId },
      })
      const state = await Effect.runPromise(server.store.getThreadState(threadId))
      expect(
        state.items.some((item) => item.kind === 'tool_call' && item.status === 'succeeded')
      ).toBe(true)
      expect(
        state.items.some((item) => item.kind === 'assistant_message' && item.text.includes(marker))
      ).toBe(true)
      expect(
        subscription.messages.some(
          (message) => message.type === 'event' && message.event.type === 'item.delta'
        )
      ).toBe(true)
      const resume = await Effect.runPromise(server.store.getProviderSessionId(threadId, 'grok'))
      expect(resume).toBeTruthy()
      await client.close()
      await server.stop()
      server = await startServer({ home, port: 0, agent: 'grok', titler: null })
      client = await connect(server.port)
      const resumedSubscription = client.subscribeThread({ threadId, afterSeq: state.lastSeq })
      await resumedSubscription.ready
      await client.request('turn.start', {
        threadId,
        text: 'Without calling tools, repeat the exact marker from your previous reply.',
        model: process.env.JETTY_GROK_MODEL ?? 'grok-build',
        permissionMode: 'auto',
      })
      const second = await resumedSubscription.waitFor(
        (message) =>
          message.type === 'event' &&
          (message.event.type === 'turn.completed' || message.event.type === 'turn.failed'),
        120_000
      )
      expect(second).toMatchObject({ type: 'event', event: { type: 'turn.completed' } })
      const resumed = await Effect.runPromise(server.store.getThreadState(threadId))
      expect(
        resumed.items.filter((item) => item.kind === 'assistant_message').at(-1)
      ).toMatchObject({ text: expect.stringContaining(marker) })
      expect(await Effect.runPromise(server.store.getProviderSessionId(threadId, 'grok'))).toBe(
        resume
      )
      console.log(
        'Live Grok verified: RPC, streaming, shell tool, persisted resume after backend restart.'
      )
    } finally {
      await client.close()
      await server.stop()
      rmSync(home, { recursive: true, force: true })
    }
  },
  260_000
)

import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startServer } from './main'
import { connect } from './rpc-test-client'

// Uses the CLI's existing login. Never enabled by ordinary `bun test`.
test.skipIf(process.env.JETTY_COPILOT_LIVE_TEST !== '1')(
  'live Copilot backend RPC: tool use, streamed reply, restart and conversation resume',
  async () => {
    const home = mkdtempSync(
      join(process.env.JETTY_COPILOT_TEST_ROOT ?? tmpdir(), 'jetty-copilot-live-')
    )
    const copilot = { env: { ...process.env, COPILOT_HOME: join(home, 'copilot') } }
    const marker = `JETTY-${newId()}`
    writeFileSync(join(home, 'marker.txt'), marker)
    let server = await startServer({ home, port: 0, agent: 'copilot', titler: null, copilot })
    let client = await connect(server.port)
    const approved = new Set<string>()
    const approvals = setInterval(() => {
      for (const message of client.messages) {
        if (
          message.type !== 'event' ||
          message.event.type !== 'item.started' ||
          message.event.item.kind !== 'approval'
        )
          continue
        const item = message.event.item
        if (approved.has(item.id)) continue
        approved.add(item.id)
        void client
          .request('approval.respond', {
            threadId: message.threadId,
            itemId: item.id,
            decision: 'allow',
          })
          .catch(() => undefined)
      }
    }, 20)
    try {
      const project = await client.request('project.create', { path: home })
      const threadId = newId()
      await client.request('thread.create', {
        environment: 'local',
        id: threadId,
        projectId: project.project.id,
      })
      const subscription = client.subscribeThread({ threadId })
      await subscription.ready
      const first = await client.request('turn.start', {
        threadId,
        text: 'Read marker.txt using a shell tool. Reply with only its exact contents. Do not write files or use network tools.',
        model: 'gpt-5-mini',
        effort: 'low',
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
      const resume = await Effect.runPromise(server.store.getProviderSessionId(threadId, 'copilot'))
      expect(resume).toBeTruthy()
      await client.close()
      await server.stop()
      server = await startServer({ home, port: 0, agent: 'copilot', titler: null, copilot })
      client = await connect(server.port)
      const resumedSubscription = client.subscribeThread({ threadId, afterSeq: state.lastSeq })
      await resumedSubscription.ready
      await client.request('turn.start', {
        threadId,
        text: 'Without calling tools, repeat the exact marker from your previous reply.',
        model: 'gpt-5-mini',
        effort: 'low',
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
      expect(await Effect.runPromise(server.store.getProviderSessionId(threadId, 'copilot'))).toBe(
        resume
      )
      console.log(
        'Live Copilot verified: RPC, streaming, shell tool, persisted resume after backend restart.'
      )
    } finally {
      clearInterval(approvals)
      await client.close()
      await server.stop()
      rmSync(home, { recursive: true, force: true })
    }
  },
  260_000
)

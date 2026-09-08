import { BunServices } from '@effect/platform-bun'
import { newId } from '@jetty/shared/wire'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentService } from './agent'

/**
 * Live Claude smoke test. Skipped unless JETTY_LIVE_TEST=1.
 * Spends real tokens — run manually: JETTY_LIVE_TEST=1 bun test server/src/claude-live.test.ts
 */
const live = process.env.JETTY_LIVE_TEST === '1'

describe.skipIf(!live)('claude live', () => {
  test('one tiny turn: spawn→init and init→first-delta timings', async () => {
    const { claudeLayer } = await import('./claude')
    const { createAttachments } = await import('./attachments')
    const { openTestStore } = await import('./store-fixture')

    const home = mkdtempSync(join(tmpdir(), 'jetty-live-'))
    const projectPath = process.cwd()
    try {
      const db = await openTestStore(home)
      const { store } = db
      const project = await Effect.runPromise(store.createProject(projectPath))
      const thread = await Effect.runPromise(store.createThread(project.id, newId()))
      const attachments = await Effect.runPromise(
        createAttachments(home).pipe(Effect.provide(BunServices.layer))
      )
      const runtime = ManagedRuntime.make(
        claudeLayer(store, attachments).pipe(Layer.provide(BunServices.layer))
      )
      const agent = await runtime.runPromise(AgentService)

      const t0 = performance.now()
      let initAt: number | null = null
      let firstDeltaAt: number | null = null
      const eventTypes: string[] = []

      const done = runtime.runPromise(
        agent
          .startTurn(
            {
              threadId: thread.id,
              turnId: 'live-turn',
              text: 'Reply with exactly the single word: pong',
              permissionMode: 'full_access',
            },
            (event) =>
              Effect.sync(() => {
                eventTypes.push(event.type)
                if (
                  firstDeltaAt === null &&
                  (event.type === 'item.delta' ||
                    (event.type === 'item.started' && event.item.kind === 'assistant_message'))
                ) {
                  firstDeltaAt = performance.now()
                }
              })
          )
          .pipe(Effect.flatMap((turn) => turn.await))
      )

      // Session id is written when system/init is translated.
      const deadline = Date.now() + 120_000
      while (
        !(await Effect.runPromise(store.getThreadSessionId(thread.id))) &&
        Date.now() < deadline
      ) {
        await Bun.sleep(10)
      }
      initAt = performance.now()

      await done

      const spawnToInitMs = Math.round((initAt ?? performance.now()) - t0)
      const initToFirstDeltaMs =
        firstDeltaAt !== null && initAt !== null ? Math.round(firstDeltaAt - initAt) : null

      console.log(
        JSON.stringify(
          {
            spawnToInitMs,
            initToFirstDeltaMs,
            eventTypes,
            sessionId: await Effect.runPromise(store.getThreadSessionId(thread.id)),
            finalStatus: (await Effect.runPromise(store.getThreadState(thread.id))).status,
          },
          null,
          2
        )
      )

      expect(await Effect.runPromise(store.getThreadSessionId(thread.id))).toBeTruthy()
      expect(eventTypes).toContain('turn.started')
      expect(eventTypes.includes('turn.completed') || eventTypes.includes('turn.failed')).toBe(true)

      await runtime.runPromise(agent.interrupt(thread.id))
      await runtime.dispose()
      await db.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 180_000)
})

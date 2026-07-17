import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Live Claude smoke test. Skipped unless JETTY_LIVE_TEST=1.
 * Spends real tokens — run manually: JETTY_LIVE_TEST=1 bun test server/src/claude-live.test.ts
 */
const live = process.env.JETTY_LIVE_TEST === '1'

describe.skipIf(!live)('claude live', () => {
  test('one tiny turn: spawn→init and init→first-delta timings', async () => {
    const { createClaudeAdapter } = await import('./claude')
    const { openDb } = await import('./db')
    const { createStore } = await import('./store')

    const home = mkdtempSync(join(tmpdir(), 'jetty-live-'))
    const projectPath = process.cwd()
    try {
      const db = openDb(home)
      const store = createStore(db)
      const project = store.createProject(projectPath, 'live')
      const thread = store.createThread(project.id)
      const agent = createClaudeAdapter(store)

      const t0 = performance.now()
      let initAt: number | null = null
      let firstDeltaAt: number | null = null
      const eventTypes: string[] = []

      const done = agent.startTurn(
        {
          threadId: thread.id,
          turnId: 'live-turn',
          text: 'Reply with exactly the single word: pong',
          permissionMode: 'full_access',
        },
        (event) => {
          eventTypes.push(event.type)
          if (
            firstDeltaAt === null &&
            (event.type === 'item.delta' ||
              (event.type === 'item.started' && event.item.kind === 'assistant_message'))
          ) {
            firstDeltaAt = performance.now()
          }
        }
      )

      // Session id is written when system/init is translated.
      const deadline = Date.now() + 120_000
      while (!store.getThreadSessionId(thread.id) && Date.now() < deadline) {
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
            sessionId: store.getThreadSessionId(thread.id),
            finalStatus: store.getThreadState(thread.id).status,
          },
          null,
          2
        )
      )

      expect(store.getThreadSessionId(thread.id)).toBeTruthy()
      expect(eventTypes).toContain('turn.started')
      expect(eventTypes.includes('turn.completed') || eventTypes.includes('turn.failed')).toBe(true)

      agent.interrupt(thread.id)
      db.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 180_000)
})

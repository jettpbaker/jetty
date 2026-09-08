import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import { TestClock } from 'effect/testing'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEchoAdapter } from './agent'
import { openDb } from './db'
import { createHub } from './hub'
import { createOrchestrator } from './orchestrator'
import { createStore, StoreError } from './store'

test('failed initial and cleanup appends release orchestrator admission for retry', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jetty-orchestrator-'))
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* Effect.acquireRelease(
            Effect.sync(() => openDb(home)),
            (db) => Effect.sync(() => db.close())
          )
          const store = createStore(db)
          const project = store.createProject(home)
          const thread = store.createThread(project.id, newId())
          let failWrites = true
          const attempts: string[] = []
          const orch = yield* createOrchestrator(
            {
              ...store,
              appendEvent(threadId, event) {
                attempts.push(event.type)
                if (failWrites) throw new StoreError('internal', 'write failed')
                return store.appendEvent(threadId, event)
              },
            },
            yield* createEchoAdapter(),
            createHub()
          )
          const failed = yield* Effect.exit(
            orch.startTurnEffect({ threadId: thread.id, text: 'first' })
          )
          expect(Exit.isFailure(failed)).toBe(true)
          expect(attempts).toEqual(['item.started', 'turn.failed'])
          expect(yield* orch.isActive(thread.id)).toBe(false)
          failWrites = false
          const retry = yield* orch.startTurnEffect({ threadId: thread.id, text: 'retry' })
          yield* TestClock.adjust(1000)
          expect(yield* orch.isActive(thread.id)).toBe(false)
          const events = store.getEventsAfter(thread.id, 0)
          expect(events.filter(({ event }) => event.type === 'turn.started')).toHaveLength(1)
          expect(events.filter(({ event }) => event.type === 'turn.completed')).toMatchObject([
            { event: { turnId: retry.turnId } },
          ])
        })
      ).pipe(Effect.provide(TestClock.layer()))
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

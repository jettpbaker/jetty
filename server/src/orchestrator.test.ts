import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Context, Effect, Exit, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEchoAdapter } from './agent'
import { databaseLayer } from './db'
import { createHub } from './hub'
import { createOrchestrator } from './orchestrator'
import { Store, storeLayer, StoreError } from './store'

test('failed initial and cleanup appends release orchestrator admission for retry', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jetty-orchestrator-'))
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(storeLayer.pipe(Layer.provide(databaseLayer(home))))
          const store = Context.get(context, Store)
          const project = yield* store.createProject(home)
          const thread = yield* store.createThread(project.id, newId())
          let failWrites = true
          const attempts: string[] = []
          const orch = yield* createOrchestrator(
            {
              ...store,
              appendEvents(threadId, events) {
                return Effect.suspend(() => {
                  attempts.push(events[0].type)
                  if (failWrites) return Effect.fail(new StoreError('internal', 'write failed'))
                  return store.appendEvents(threadId, events)
                })
              },
              appendEvent(threadId, event) {
                return Effect.suspend(() => {
                  attempts.push(event.type)
                  if (failWrites) return Effect.fail(new StoreError('internal', 'write failed'))
                  return store.appendEvent(threadId, event)
                })
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
          const events = yield* store.getEventsAfter(thread.id, 0)
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

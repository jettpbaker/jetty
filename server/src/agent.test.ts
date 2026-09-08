import type { ThreadEvent } from '@jetty/shared/events'

import { expect, test } from 'bun:test'
import { Deferred, Effect, Exit } from 'effect'
import { TestClock } from 'effect/testing'

import { AgentError, createEchoAdapter } from './agent'

test('echo rejects steering once assistant completion is being published', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const agent = yield* createEchoAdapter()
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const events: ThreadEvent[] = []
        let assistantId: string | undefined
        const turn = yield* agent.startTurn(
          { threadId: 'thread', turnId: 'first', text: 'hello' },
          (event) =>
            Effect.gen(function* () {
              if (event.type === 'item.started' && event.item.kind === 'assistant_message')
                assistantId = event.item.id
              if (event.type === 'item.completed' && event.itemId === assistantId) {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              }
              events.push(event)
            })
        )
        yield* TestClock.adjust(1000)
        yield* Deferred.await(entered)
        expect(yield* agent.steer('thread', 'late input')).toBe(false)
        yield* Deferred.succeed(release, undefined)
        yield* turn.await
        expect(
          events
            .filter((event) => event.type === 'item.delta' && event.itemId === assistantId)
            .map((event) => (event.type === 'item.delta' ? event.delta : ''))
            .join('')
        ).toBe('hello')
        expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(1)
      })
    ).pipe(Effect.provide(TestClock.layer()))
  )
})

test('a failed echo emitter settles the turn and does not leave a stuck session', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const agent = yield* createEchoAdapter()
        const failed = yield* agent.startTurn(
          { threadId: 'thread', turnId: 'failed', text: 'hello' },
          () => Effect.fail(new AgentError('append failed'))
        )
        expect(Exit.isFailure(yield* Effect.exit(failed.await))).toBe(true)
        const events: ThreadEvent[] = []
        const next = yield* agent.startTurn(
          { threadId: 'thread', turnId: 'next', text: 'hello' },
          (event) =>
            Effect.sync(() => {
              events.push(event)
            })
        )
        yield* TestClock.adjust(1000)
        yield* next.await
        expect(events.filter((event) => event.type === 'turn.completed')).toMatchObject([
          { turnId: 'next' },
        ])
      })
    ).pipe(Effect.provide(TestClock.layer()))
  )
})

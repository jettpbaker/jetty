import { expect, test } from 'bun:test'
import { Deferred, Effect, Fiber } from 'effect'

import { createRequestChain } from '../../client/src/state/queue_requests'

for (const action of ['remove', 'edit', 'sendNow', 'hold', 'release']) {
  test(`${action} after Undo waits for the pending remove and restore`, async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const request = createRequestChain()
        const removed = yield* Deferred.make<void>()
        const restored = yield* Deferred.make<void>()
        const calls: string[] = []
        let queued = true
        function start(name: string, effect: Effect.Effect<void>) {
          return request('message', (wait) =>
            Effect.runFork(
              wait.pipe(Effect.andThen(Effect.sync(() => calls.push(name))), Effect.andThen(effect))
            )
          )
        }
        const remove = start(
          'remove',
          Deferred.await(removed).pipe(
            Effect.andThen(
              Effect.sync(() => {
                queued = false
              })
            )
          )
        )
        const restore = start(
          'restore',
          Deferred.await(restored).pipe(
            Effect.andThen(
              Effect.sync(() => {
                queued = true
              })
            )
          )
        )
        const next = start(
          action,
          Effect.sync(() => {
            expect(queued).toBe(true)
            if (action === 'remove' || action === 'sendNow') queued = false
          })
        )
        yield* Effect.yieldNow
        expect(calls).toEqual(['remove'])
        yield* Deferred.succeed(removed, undefined)
        yield* Fiber.join(remove)
        yield* Effect.yieldNow
        expect(calls).toEqual(['remove', 'restore'])
        yield* Deferred.succeed(restored, undefined)
        yield* Fiber.join(restore)
        yield* Fiber.join(next)
        expect(calls).toEqual(['remove', 'restore', action])
        expect(queued).toBe(action !== 'remove' && action !== 'sendNow')
      })
    )
  })
}

test('queue requests isolate keys and continue after a failed predecessor', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = createRequestChain()
      const release = yield* Deferred.make<void>()
      const first = request('first', (wait) =>
        Effect.runFork(
          wait.pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(Effect.fail('failed')))
        )
      )
      const second = request('second', (wait) => Effect.runFork(wait))
      yield* Fiber.join(second)
      const next = request('first', (wait) => Effect.runFork(wait))
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.await(first)
      yield* Fiber.join(next)
    })
  )
})

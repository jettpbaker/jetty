import type { ThreadEvent } from '@jetty/shared/events'

import { Effect, Fiber, Scope } from 'effect'

import type { Attachments } from './attachments'

export type MediaToolHost = {
  attachments: Attachments
  projectPath: string
  turnId: () => string
  emit: (
    event: ThreadEvent,
    turnId: string,
    onCommit: Effect.Effect<void>
  ) => Effect.Effect<void, Error>
}

export const createMediaToolRunner = Effect.gen(function* () {
  const scope = yield* Scope.Scope
  return function run<A, E>(effect: Effect.Effect<A, E>, extra: unknown): Promise<A> {
    const signal =
      extra && typeof extra === 'object' && 'signal' in extra && extra.signal instanceof AbortSignal
        ? extra.signal
        : undefined
    return Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkIn(effect, scope)
        return yield* Fiber.join(fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber)))
      }),
      { signal }
    )
  }
})

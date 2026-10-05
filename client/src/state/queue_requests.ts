import { Effect, Fiber } from 'effect'

export function createQueueRequests() {
  const pending = new Map<string, Fiber.Fiber<unknown, unknown>>()

  return function request<A, E>(
    threadId: string,
    messageId: string,
    start: (wait: Effect.Effect<void>) => Fiber.Fiber<A, E>
  ) {
    const key = JSON.stringify([threadId, messageId])
    const previous = pending.get(key)
    const wait = previous ? Fiber.join(previous).pipe(Effect.ignore, Effect.asVoid) : Effect.void
    const fiber = start(wait)
    pending.set(key, fiber)
    fiber.addObserver(() => {
      if (pending.get(key) === fiber) pending.delete(key)
    })
    return fiber
  }
}

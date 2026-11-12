import { Effect, Fiber } from 'effect'

// Runs each key's requests one after another: `start` is handed the wait for the one before it.
export function createRequestChain() {
  const latest = new Map<string, Fiber.Fiber<unknown, unknown>>()

  return function chain<A, E>(
    key: string,
    start: (wait: Effect.Effect<void>) => Fiber.Fiber<A, E>
  ) {
    const previous = latest.get(key)
    const wait = previous ? Fiber.join(previous).pipe(Effect.ignore, Effect.asVoid) : Effect.void
    const fiber = start(wait)
    latest.set(key, fiber)
    fiber.addObserver(() => {
      if (latest.get(key) === fiber) latest.delete(key)
    })
    return fiber
  }
}

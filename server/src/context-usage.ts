import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage } from '@jetty/shared/events'

import { Cause, Clock, Effect, Fiber, type Scope } from 'effect'

const DEFAULT_WINDOW = 200_000
const NATIVE_1M_WINDOW = 1_000_000

/**
 * Models Claude Code treats as native 1M. Safety net when the CLI still
 * reports the 200k default (catalog miss or getModelCapability fallthrough).
 * `sonnet-5` must not match `sonnet-4-5`.
 */
const NATIVE_1M =
  /(?:^|[^a-z0-9])(?:claude-)?(?:fable-5(?:-1)?|mythos-5(?:-1)?|sonnet-5|opus-5|opus-4-[789])(?:$|[^0-9])/i

const SKIP_CATEGORIES = new Set(['free space', 'autocompact buffer', 'compact buffer'])

function is1mDisabled(): boolean {
  const raw = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  if (raw == null) return false
  return raw === '1' || raw.toLowerCase() === 'true'
}

function has1mSuffix(model: string): boolean {
  return /\[1m\]/i.test(model)
}

/** Lift a 200k report to 1M when the model is native-1M in Claude Code. */
export function resolveContextWindow(reported: number, model?: string): number {
  const raw = Math.round(reported)
  if (raw <= 0) return raw
  if (is1mDisabled()) return raw
  if (model && has1mSuffix(model)) return Math.max(raw, NATIVE_1M_WINDOW)
  if (raw > DEFAULT_WINDOW) return raw
  if (model && NATIVE_1M.test(model)) return NATIVE_1M_WINDOW
  return raw
}

function isSkippedCategory(name: string, deferred?: boolean): boolean {
  if (deferred) return true
  return SKIP_CATEGORIES.has(name.toLowerCase())
}

/** Only place the SDK getContextUsage method name may appear. */
export async function readContextUsage(query: Query): Promise<ContextUsage | null> {
  try {
    const response = await query.getContextUsage()
    // Zero is a miss, not a 0%-full ring: maxTokens is the divisor for every percentage
    // downstream, and a session reports no used tokens until it has called the API once.
    if (response.maxTokens <= 0 && response.rawMaxTokens <= 0) return null

    const reported = Math.max(
      Math.round(response.rawMaxTokens || 0),
      Math.round(response.maxTokens || 0)
    )
    const max = resolveContextWindow(reported, response.model)

    const slices: ContextUsage['slices'][number][] = []
    for (const cat of response.categories) {
      const tokens = Math.round(cat.tokens)
      if (tokens <= 0) continue
      if (isSkippedCategory(cat.name, cat.isDeferred)) continue
      slices.push({ label: cat.name, tokens })
    }

    // Category sum is what the model actually sees after compact-boundary /
    // microcompact. `totalTokens` is last-request API usage and stays high
    // across a compact until the next call — that's the "doesn't track
    // compaction" / "climbs faster than CC" number.
    const fromSlices = slices.reduce((sum, slice) => sum + slice.tokens, 0)
    const fromTotal = Math.round(response.totalTokens)
    const usedTokens = fromSlices > 0 ? fromSlices : fromTotal
    if (usedTokens <= 0) return null

    const threshold = response.autoCompactThreshold
    let compactAt =
      response.isAutoCompactEnabled && threshold != null && threshold > 0
        ? Math.round(threshold)
        : undefined
    // When we lift a 200k report to 1M, the CLI's compact line is still in
    // 200k-space — scale it so the ring and the copy stay on the same window.
    if (compactAt != null && reported > 0 && max > reported) {
      compactAt = Math.round(compactAt * (max / reported))
    }

    const model = response.model.length > 0 ? response.model : undefined

    return {
      usedTokens,
      maxTokens: max,
      ...(compactAt != null ? { compactAt } : {}),
      slices,
      ...(model ? { model } : {}),
      asOf: Date.now(),
    }
  } catch {
    // closing query throws; treat as miss
    return null
  }
}

const POLL_MS = 2500
/** Below this the number hasn't moved enough to be worth a ledger entry. */
const MOVEMENT_FLOOR = 1000
const MOVEMENT_FRACTION = 0.005

export type ContextPoller = {
  /** `force` skips the throttle and the movement threshold; turn end always forces. */
  poll: (force?: boolean) => Effect.Effect<void>
  stop: () => Effect.Effect<void>
}

export function createContextPoller(io: {
  read: Effect.Effect<ContextUsage | null>
  emit: (usage: ContextUsage) => Effect.Effect<void>
  pollMs?: number
}): Effect.Effect<ContextPoller, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    const pollMs = io.pollMs ?? POLL_MS
    let lastPollAt = Number.NEGATIVE_INFINITY
    let inFlight = false
    let fiber: Fiber.Fiber<void> | undefined
    let forcedWaiting = false
    let stopped = false
    let lastEmitted: { usedTokens: number; maxTokens: number; compactAt?: number } | null = null

    function shouldEmit(usage: ContextUsage, force: boolean): boolean {
      if (!lastEmitted) return true
      if (usage.maxTokens !== lastEmitted.maxTokens) return true
      if (usage.compactAt !== lastEmitted.compactAt) return true
      const delta = Math.abs(usage.usedTokens - lastEmitted.usedTokens)
      // An unmoved number is not news, however authoritative the read was.
      if (delta === 0) return false
      if (force) return true
      return delta >= Math.max(MOVEMENT_FLOOR, usage.maxTokens * MOVEMENT_FRACTION)
    }

    function poll(force = false) {
      return Effect.gen(function* () {
        if (stopped) return
        if (inFlight) {
          // The forced read is the number that stays on screen after a turn, so it
          // waits for the in-flight one instead of being dropped.
          if (force) forcedWaiting = true
          return
        }
        const at = yield* Clock.currentTimeMillis
        if (!force && at - lastPollAt < pollMs) return
        inFlight = true
        lastPollAt = at
        const read = Effect.gen(function* () {
          let readForce = force
          do {
            yield* Effect.gen(function* () {
              const usage = yield* io.read
              if (!usage || stopped || !shouldEmit(usage, readForce)) return
              yield* io.emit(usage)
              lastEmitted = {
                usedTokens: usage.usedTokens,
                maxTokens: usage.maxTokens,
                compactAt: usage.compactAt,
              }
            }).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.void
              )
            )
            if (stopped || !forcedWaiting) return
            forcedWaiting = false
            readForce = true
            lastPollAt = yield* Clock.currentTimeMillis
          } while (!stopped)
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              inFlight = false
            })
          )
        )
        fiber = yield* Effect.forkIn(read, scope)
      }).pipe(Effect.uninterruptible)
    }

    function stop() {
      return Effect.gen(function* () {
        stopped = true
        forcedWaiting = false
        if (fiber) yield* Fiber.interrupt(fiber)
      }).pipe(Effect.uninterruptible)
    }

    yield* Effect.addFinalizer(stop)
    return { poll, stop }
  })
}

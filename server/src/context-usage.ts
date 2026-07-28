import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage } from '@jetty/shared/events'

/** Only place the SDK getContextUsage method name may appear. */
export async function readContextUsage(query: Query): Promise<ContextUsage | null> {
  if (typeof query.getContextUsage !== 'function') return null
  try {
    const response = await query.getContextUsage()
    const maxTokens = Number(response.maxTokens)
    const totalTokens = Number(response.totalTokens)
    if (!Number.isFinite(maxTokens) || maxTokens <= 0) return null
    if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null

    const max = Math.round(maxTokens)
    const usedTokens = Math.min(Math.round(totalTokens), max)

    const slices: ContextUsage['slices'] = []
    for (const cat of response.categories ?? []) {
      const tokens = Math.round(Number(cat.tokens))
      if (!Number.isFinite(tokens) || tokens <= 0) continue
      if (typeof cat.name === 'string' && cat.name.toLowerCase() === 'free space') continue
      slices.push({ label: String(cat.name), tokens })
    }

    const threshold = response.autoCompactThreshold
    const compactAt =
      response.isAutoCompactEnabled &&
      threshold != null &&
      Number.isFinite(threshold) &&
      threshold > 0
        ? Math.round(threshold)
        : undefined

    const model =
      typeof response.model === 'string' && response.model.length > 0 ? response.model : undefined

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
  poll: (force?: boolean) => void
  stop: () => void
}

export function createContextPoller(io: {
  read: () => Promise<ContextUsage | null>
  emit: (usage: ContextUsage) => void
  pollMs?: number
  now?: () => number
}): ContextPoller {
  const pollMs = io.pollMs ?? POLL_MS
  const now = io.now ?? Date.now
  let lastPollAt = Number.NEGATIVE_INFINITY
  let inFlight = false
  let forcedWaiting = false
  let stopped = false
  let lastEmitted: { usedTokens: number; maxTokens: number } | null = null

  function shouldEmit(usage: ContextUsage, force: boolean): boolean {
    if (!lastEmitted) return true
    if (usage.maxTokens !== lastEmitted.maxTokens) return true
    const delta = Math.abs(usage.usedTokens - lastEmitted.usedTokens)
    // An unmoved number is not news, however authoritative the read was.
    if (delta === 0) return false
    if (force) return true
    return delta >= Math.max(MOVEMENT_FLOOR, usage.maxTokens * MOVEMENT_FRACTION)
  }

  function poll(force = false) {
    if (stopped) return
    if (inFlight) {
      // The forced read is the number that stays on screen after a turn, so it
      // waits for the in-flight one instead of being dropped.
      if (force) forcedWaiting = true
      return
    }
    const at = now()
    if (!force && at - lastPollAt < pollMs) return
    inFlight = true
    lastPollAt = at
    void io
      .read()
      .then((usage) => {
        if (!usage || stopped || !shouldEmit(usage, force)) return
        lastEmitted = { usedTokens: usage.usedTokens, maxTokens: usage.maxTokens }
        io.emit(usage)
      })
      .catch(() => {})
      .finally(() => {
        inFlight = false
        if (forcedWaiting) {
          forcedWaiting = false
          poll(true)
        }
      })
  }

  return {
    poll,
    stop() {
      stopped = true
    },
  }
}

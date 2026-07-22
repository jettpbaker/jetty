import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { Usage, UsageWindow } from '@jetty/shared/wire'

/** Only place the experimental SDK usage method name may appear. */
export async function readUsage(query: Query): Promise<Usage | null> {
  try {
    const raw = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
    if (!raw.rate_limits_available || !raw.rate_limits) return null

    const fiveHour = toWindow(raw.rate_limits.five_hour)
    const sevenDay = toWindow(raw.rate_limits.seven_day)
    if (!fiveHour || !sevenDay) return null

    return { fiveHour, sevenDay, asOf: Date.now() }
  } catch {
    // closing query throws "Query closed before response received"; treat as miss
    return null
  }
}

function toWindow(
  window: { utilization: number | null; resets_at: string | null } | null | undefined
): UsageWindow | null {
  if (!window) return null
  if (window.utilization == null || window.resets_at == null) return null
  const resetsAt = Date.parse(window.resets_at)
  if (Number.isNaN(resetsAt)) return null
  return { pct: window.utilization, resetsAt }
}

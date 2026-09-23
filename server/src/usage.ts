import type { Query, SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import type { ExtraUsage, Usage, UsageWindow } from '@jetty/shared/wire'

type RawExtraUsage = NonNullable<
  NonNullable<SDKControlGetUsageResponse['rate_limits']>['extra_usage']
>

// The only place the experimental SDK usage method name may appear.
export async function readUsage(query: Query): Promise<Usage | null> {
  try {
    const raw = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
    if (!raw.rate_limits_available || !raw.rate_limits) return null

    const fiveHour = toWindow(raw.rate_limits.five_hour)
    const sevenDay = toWindow(raw.rate_limits.seven_day)
    if (!fiveHour || !sevenDay) return null

    const extraUsage = toExtraUsage(raw.rate_limits.extra_usage)
    return { fiveHour, sevenDay, ...(extraUsage ? { extraUsage } : {}), asOf: Date.now() }
  } catch {
    return null
  }
}

function toWindow(
  window: { utilization: number | null; resets_at: string | null } | null | undefined
): UsageWindow | null {
  if (window?.utilization == null || window.resets_at == null) return null
  const resetsAt = Date.parse(window.resets_at)
  if (Number.isNaN(resetsAt)) return null
  return { pct: window.utilization, resetsAt }
}

function toExtraUsage(raw: RawExtraUsage | null | undefined): ExtraUsage | undefined {
  if (!raw?.is_enabled || raw.used_credits == null || raw.monthly_limit == null) return undefined
  if (!(raw.monthly_limit > 0) || raw.used_credits < 0) return undefined
  // The SDK reports cents.
  const used = raw.used_credits / 100
  const limit = raw.monthly_limit / 100
  const pct = raw.utilization ?? (used / limit) * 100
  return { used, limit, pct, currency: raw.currency ?? 'USD' }
}

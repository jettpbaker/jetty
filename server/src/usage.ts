import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderUsage } from '@jetty/shared/wire'

import { claudePlan, claudeUsageWindows } from './provider-usage'

// The only place the experimental SDK usage method name may appear.
export async function readUsage(query: Query): Promise<ProviderUsage | null> {
  try {
    const raw = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
    if (!raw.rate_limits_available || !raw.rate_limits) return null
    const windows = claudeUsageWindows(raw.rate_limits)
    if (windows.length === 0) return null
    const plan = claudePlan(raw.subscription_type)
    return {
      provider: 'claude',
      connected: true,
      windows,
      ...(plan ? { plan } : {}),
      asOf: Date.now(),
    }
  } catch {
    return null
  }
}

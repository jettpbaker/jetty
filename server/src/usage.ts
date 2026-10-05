import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderUsage } from '@jetty/shared/wire'

import { claudeUsageWindows, readClaudePlan, readClaudeUsageIdentity } from './provider-usage'

// The only place the experimental SDK usage method name may appear.
export async function readUsage(query: Query, identity?: string): Promise<ProviderUsage | null> {
  try {
    const account = identity ? await query.accountInfo() : undefined
    if (identity && (!account || (await readClaudeUsageIdentity(account)) !== identity)) return null
    // Jetty only uses the plan limits. The behaviors scan reads a week of local transcripts.
    const raw = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    })
    if (account && (await readClaudeUsageIdentity(account)) !== identity) return null
    if (!raw.rate_limits_available || !raw.rate_limits) return null
    const windows = claudeUsageWindows(raw.rate_limits)
    if (windows.length === 0) return null
    const plan = await readClaudePlan(raw.subscription_type)
    return {
      provider: 'claude',
      connected: true,
      ...(identity ? { identity } : {}),
      windows,
      ...(plan ? { plan } : {}),
      asOf: Date.now(),
    }
  } catch {
    return null
  }
}

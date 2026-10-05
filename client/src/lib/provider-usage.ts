import type { ProviderUsage } from '@jetty/shared/wire'

// A failed read the server has nothing for (it restarted) keeps this account's last windows.
export function lastGood(previous: ProviderUsage | undefined, usage: ProviderUsage): ProviderUsage {
  if (!usage.failed || usage.windows.length || !previous?.windows.length) return usage
  if (!usage.identity || previous.identity !== usage.identity) return usage
  return { ...usage, windows: previous.windows, ...(previous.asOf ? { asOf: previous.asOf } : {}) }
}

import type { ProviderUsage } from '@jetty/shared/wire'

// A failed read the server has nothing for (it restarted) keeps this account's last windows.
export function lastGood(previous: ProviderUsage | undefined, usage: ProviderUsage): ProviderUsage {
  if (!usage.failed || usage.windows.length || !previous?.windows.length) return usage
  if (!sameOwner(previous, usage)) return usage
  return { ...usage, windows: previous.windows, ...(previous.asOf ? { asOf: previous.asOf } : {}) }
}

// Claude's limits belong to an organization, which one email can switch between, so only its
// opaque identity matches; Codex and Grok send none, and their limits follow the account.
function sameOwner(previous: ProviderUsage, usage: ProviderUsage) {
  if (usage.provider === 'claude') return !!usage.identity && previous.identity === usage.identity
  return previous.account === usage.account
}

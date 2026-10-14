import type { ProviderUsage, UsageWindow } from '@jetty/shared/wire'

import { Effect } from 'effect'

import { copilotBin, probeCopilotSession } from './copilot-rpc'
import { ghToken } from './pull-requests'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

export function readCopilotProviderUsage(cwd: string, options: StdioProcessOptions = {}) {
  const missing: ProviderUsage = {
    provider: 'copilot',
    connected: false,
    installed: false,
    windows: [],
  }
  if (!Bun.which(copilotBin(options))) return Effect.succeed(missing)
  return Effect.scoped(
    Effect.gen(function* () {
      const [, quota] = yield* Effect.all([probeCopilotSession(cwd, options), readCopilotQuota()], {
        concurrency: 'unbounded',
      })
      return {
        provider: 'copilot',
        connected: true,
        installed: true,
        windows: [],
        ...quota,
        asOf: Date.now(),
      } satisfies ProviderUsage
    })
  ).pipe(
    Effect.timeout('8 seconds'),
    Effect.catch((error) =>
      Effect.succeed({
        provider: 'copilot' as const,
        connected: false,
        installed: true,
        windows: [],
        ...(/not.*(?:logged|signed)\s*in|authentication required|login required|unauthenticated/i.test(
          String(error)
        )
          ? {}
          : { failed: true }),
      })
    )
  )
}

// ACP has no quota API, so this asks GitHub's own endpoint for Copilot clients, as gh's login.
// It's undocumented: a failed or unfamiliar read shows no bar rather than a wrong one.
function readCopilotQuota() {
  return Effect.tryPromise(async () => {
    const token = await ghToken()
    if (!token) return {}
    const response = await fetch('https://api.github.com/copilot_internal/user', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    return response.ok ? copilotQuota(await response.json()) : {}
  }).pipe(Effect.catch(() => Effect.succeed({})))
}

function copilotQuota(raw: unknown) {
  const user = object(raw)
  const credits = object(object(user.quota_snapshots).premium_interactions)
  const left = credits.percent_remaining
  const resetsAt = Date.parse(string(user.quota_reset_date_utc))
  const windows: UsageWindow[] = []
  if (credits.unlimited !== true && typeof left === 'number' && Number.isFinite(left)) {
    const start = new Date(resetsAt)
    start.setUTCMonth(start.getUTCMonth() - 1)
    windows.push({
      id: 'monthly',
      label: 'Monthly',
      pct: Math.max(0, 100 - left),
      ...(Number.isFinite(resetsAt)
        ? { resetsAt, minutes: (resetsAt - start.getTime()) / 60_000 }
        : {}),
    })
  }
  const plan = string(user.copilot_plan)
  const login = string(user.login)
  return {
    windows,
    ...(plan ? { plan: plan.charAt(0).toUpperCase() + plan.slice(1) } : {}),
    ...(login ? { account: login } : {}),
  }
}

import type { ProviderUsage } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

import { openCodexConnection } from './codex-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

const CLAUDE_CACHE_MS = 60_000
let claudeCache: { at: number; usage: ProviderUsage } | undefined

function windowFrom(raw: unknown, id: string, label: string) {
  const value = object(raw)
  const pct = value.utilization
  const resetsAt = Date.parse(string(value.resets_at))
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null
  return { id, label, pct, ...(Number.isFinite(resetsAt) ? { resetsAt } : {}) }
}

async function claudeToken(): Promise<string | undefined> {
  try {
    const credentials =
      platform() === 'darwin'
        ? execFileSync(
            'security',
            ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
            {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 2_000,
            }
          )
        : await readFile(join(homedir(), '.claude', '.credentials.json'), 'utf8')
    const oauth = object(object(JSON.parse(credentials)).claudeAiOauth)
    const token = string(oauth.accessToken)
    return token || undefined
  } catch {
    return undefined
  }
}

export async function readClaudeProviderUsage(
  fallback?: () => ProviderUsage | undefined
): Promise<ProviderUsage> {
  const token = await claudeToken()
  if (!token) return { provider: 'claude', connected: false, windows: [] }
  if (claudeCache && Date.now() - claudeCache.at < CLAUDE_CACHE_MS) return claudeCache.usage
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(4_000),
    })
    if (!response.ok) throw new Error('Claude usage unavailable')
    const raw = object(await response.json())
    const windows = [
      windowFrom(raw.five_hour, 'five-hour', '5 hour'),
      windowFrom(raw.seven_day, 'seven-day', 'Weekly'),
    ].filter((item) => item !== null)
    if (windows.length === 0) throw new Error('Claude usage unavailable')
    const usage: ProviderUsage = { provider: 'claude', connected: true, windows, asOf: Date.now() }
    claudeCache = { at: Date.now(), usage }
    return usage
  } catch {
    return fallback?.() ?? { provider: 'claude', connected: true, windows: [] }
  }
}

function codexWindow(raw: unknown, id: string) {
  const window = object(raw)
  if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return null
  const mins = window.windowDurationMins
  const label =
    typeof mins === 'number' && mins > 0
      ? mins % 10_080 === 0
        ? `${mins / 10_080} week`
        : mins % 60 === 0
          ? `${mins / 60} hour`
          : `${mins} minute`
      : id === 'primary'
        ? 'Primary'
        : 'Secondary'
  const resetsAt = typeof window.resetsAt === 'number' ? window.resetsAt * 1000 : undefined
  return { id, label, pct: window.usedPercent, ...(resetsAt ? { resetsAt } : {}) }
}

export function readCodexProviderUsage(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* openCodexConnection(cwd, options)
      const account = yield* connection.request('account/read', {})
      if (!account.account)
        return { provider: 'codex', connected: false, windows: [] } satisfies ProviderUsage
      const result = yield* connection
        .request('account/rateLimits/read', {})
        .pipe(Effect.catch(() => Effect.succeed(null)))
      if (!result)
        return { provider: 'codex', connected: true, windows: [] } satisfies ProviderUsage
      const rateLimits = object(result.rateLimits)
      const windows = [
        codexWindow(rateLimits.primary, 'primary'),
        codexWindow(rateLimits.secondary, 'secondary'),
      ].filter((item) => item !== null)
      const plan = string(rateLimits.planType) || string(object(account.account).planType)
      return {
        provider: 'codex',
        connected: true,
        windows,
        ...(plan ? { plan } : {}),
        asOf: Date.now(),
      } satisfies ProviderUsage
    })
  ).pipe(
    Effect.timeout('8 seconds'),
    Effect.catch(() =>
      Effect.succeed({ provider: 'codex', connected: false, windows: [] } satisfies ProviderUsage)
    )
  )
}

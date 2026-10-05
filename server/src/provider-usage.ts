import type { ProviderUsage, UsageWindow } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

import { openCodexConnection } from './codex-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

const CACHE_MS = 60_000
let claudeCache: { at: number; usage: ProviderUsage } | undefined
let grokCache: { at: number; usage: ProviderUsage } | undefined

function capitalized(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function claudePlan(subscription: unknown, tier?: unknown): string | undefined {
  const value = string(subscription).toLowerCase()
  if (!value) return undefined
  if (value !== 'max') return capitalized(value)
  const limit = string(tier).toLowerCase()
  return limit.includes('20x') ? 'Max 20×' : limit.includes('5x') ? 'Max 5×' : 'Max'
}

function claudeWindow(
  raw: unknown,
  id: string,
  label: string,
  minutes: number
): UsageWindow | null {
  const value = object(raw)
  const pct = value.utilization
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null
  const resetsAt = Date.parse(string(value.resets_at))
  return { id, label, pct, minutes, ...(Number.isFinite(resetsAt) ? { resetsAt } : {}) }
}

export function claudeUsageWindows(raw: unknown): UsageWindow[] {
  const limits = object(raw)
  const windows: UsageWindow[] = []
  for (const [key, id, label, minutes] of [
    ['five_hour', 'five-hour', '5-hour', 300],
    ['seven_day', 'seven-day', 'Weekly', 10_080],
    ['seven_day_opus', 'seven-day-opus', 'Weekly · Opus', 10_080],
    ['seven_day_sonnet', 'seven-day-sonnet', 'Weekly · Sonnet', 10_080],
  ] as const) {
    const window = claudeWindow(limits[key], id, label, minutes)
    if (window) windows.push(window)
  }
  if (Array.isArray(limits.model_scoped)) {
    for (const entry of limits.model_scoped) {
      const name = string(object(entry).display_name).trim()
      if (!name) continue
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      if (!slug) continue
      const window = claudeWindow(entry, `seven-day-${slug}`, `Weekly · ${name}`, 10_080)
      if (window) windows.push(window)
    }
  }
  return windows
}

async function claudeCredentials(): Promise<Record<string, unknown>> {
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
    return object(object(JSON.parse(credentials)).claudeAiOauth)
  } catch {
    return {}
  }
}

async function claudeAccount(): Promise<string | undefined> {
  try {
    const config = object(JSON.parse(await readFile(join(homedir(), '.claude.json'), 'utf8')))
    return string(object(config.oauthAccount).emailAddress) || undefined
  } catch {
    return undefined
  }
}

export async function readClaudeProviderUsage(): Promise<ProviderUsage> {
  const oauth = await claudeCredentials()
  const token = string(oauth.accessToken)
  const plan = claudePlan(oauth.subscriptionType, oauth.rateLimitTier)
  const account = await claudeAccount()
  const metadata = { ...(plan ? { plan } : {}), ...(account ? { account } : {}) }
  if (!token) return { provider: 'claude', connected: false, windows: [], ...metadata }
  if (claudeCache && Date.now() - claudeCache.at < CACHE_MS)
    return { ...claudeCache.usage, ...metadata }
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(4_000),
    })
    if (!response.ok) throw new Error('Claude usage unavailable')
    const windows = claudeUsageWindows(await response.json())
    if (windows.length === 0) throw new Error('Claude usage unavailable')
    const usage: ProviderUsage = {
      provider: 'claude',
      connected: true,
      windows,
      ...metadata,
      asOf: Date.now(),
    }
    claudeCache = { at: Date.now(), usage }
    return usage
  } catch {
    return {
      ...(claudeCache?.usage ?? { provider: 'claude', connected: true, windows: [] }),
      ...metadata,
    }
  }
}

function codexWindow(
  raw: unknown,
  limitId: string,
  slot: 'primary' | 'secondary',
  name: string
): UsageWindow | null {
  const window = object(raw)
  const pct = window.usedPercent
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null
  const duration = window.windowDurationMins
  const minutes =
    typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : slot === 'primary'
        ? 300
        : 10_080
  const label =
    minutes === 300
      ? '5-hour'
      : minutes === 10_080
        ? 'Weekly'
        : minutes >= 40_320
          ? 'Monthly'
          : minutes % 1440 === 0
            ? `${minutes / 1440}-day`
            : minutes % 60 === 0
              ? `${minutes / 60}-hour`
              : `${minutes}-minute`
  const seconds = window.resetsAt
  const resetsAt =
    typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : undefined
  return {
    id: `${limitId}-${slot}`,
    label: limitId === 'codex' ? label : `${label} · ${name}`,
    pct,
    minutes,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

export function readCodexProviderUsage(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* openCodexConnection(cwd, options)
      const account = yield* connection.request('account/read', {})
      if (!account.account)
        return { provider: 'codex', connected: false, windows: [] } satisfies ProviderUsage
      const identity = object(account.account)
      const email = string(identity.email)
      const accountPlan = string(identity.planType)
      const result = yield* connection
        .request('account/rateLimits/read', {})
        .pipe(Effect.catch(() => Effect.succeed(null)))
      if (!result)
        return {
          provider: 'codex',
          connected: true,
          windows: [],
          ...(accountPlan ? { plan: capitalized(accountPlan.toLowerCase()) } : {}),
          ...(email ? { account: email } : {}),
        } satisfies ProviderUsage
      const buckets = object(result.rateLimitsByLimitId)
      const entries = Object.entries(buckets)
      if (entries.length === 0 && result.rateLimits) entries.push(['codex', result.rateLimits])
      entries.sort(([a], [b]) => (a === 'codex' ? -1 : b === 'codex' ? 1 : 0))
      const windows: UsageWindow[] = []
      for (const [key, raw] of entries) {
        const bucket = object(raw)
        const limitId = string(bucket.limitId) || key
        const name = string(bucket.limitName) || limitId
        for (const slot of ['primary', 'secondary'] as const) {
          const window = codexWindow(bucket[slot], limitId, slot, name)
          if (window) windows.push(window)
        }
      }
      const plan =
        string(object(result.rateLimits).planType) ||
        string(object(buckets.codex).planType) ||
        accountPlan
      return {
        provider: 'codex',
        connected: true,
        windows,
        ...(plan ? { plan: capitalized(plan.toLowerCase()) } : {}),
        ...(email ? { account: email } : {}),
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

export async function readGrokProviderUsage(): Promise<ProviderUsage> {
  if (process.env.XAI_API_KEY) return { provider: 'grok', connected: false, windows: [] }
  let credential: Record<string, unknown>
  try {
    const home = process.env.GROK_HOME || join(homedir(), '.grok')
    const auth = object(JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')))
    credential = object(
      auth['https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828'] ??
        auth['https://accounts.x.ai/sign-in']
    )
  } catch {
    return { provider: 'grok', connected: false, windows: [] }
  }
  const key = string(credential.key)
  if (!key) return { provider: 'grok', connected: false, windows: [] }
  const account = string(credential.email)
  const metadata = account ? { account } : {}
  if (credential.auth_mode === 'api_key')
    return { provider: 'grok', connected: true, windows: [], ...metadata }
  if (grokCache && Date.now() - grokCache.at < CACHE_MS) return { ...grokCache.usage, ...metadata }
  try {
    const response = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4_000),
    })
    if (!response.ok) throw new Error('Grok usage unavailable')
    const config = object(object(await response.json()).config)
    const period = object(config.currentPeriod)
    const end = Date.parse(string(period.end))
    const start = Date.parse(string(period.start))
    const pct = config.creditUsagePercent === undefined ? 0 : config.creditUsagePercent
    const windows: UsageWindow[] = []
    if (Number.isFinite(end) && typeof pct === 'number' && Number.isFinite(pct)) {
      const label =
        period.type === 'USAGE_PERIOD_TYPE_WEEKLY'
          ? 'Weekly'
          : period.type === 'USAGE_PERIOD_TYPE_MONTHLY'
            ? 'Monthly'
            : 'Billing period'
      windows.push({
        id: 'grok-period',
        label,
        pct,
        resetsAt: end,
        ...(Number.isFinite(start) ? { minutes: (end - start) / 60_000 } : {}),
      })
    }
    const usage: ProviderUsage = {
      provider: 'grok',
      connected: true,
      windows,
      ...metadata,
      asOf: Date.now(),
    }
    grokCache = { at: Date.now(), usage }
    return usage
  } catch {
    return {
      ...(grokCache?.usage ?? { provider: 'grok', connected: true, windows: [] }),
      ...metadata,
    }
  }
}

import type { ProviderUsage, UsageWindow } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

import { openCodexConnection } from './codex-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

// Each read is kept for the account it was read for; signing in as another starts afresh.
const CACHE_MS = 60_000
let claudeCache: { account: string; at: number; usage: ProviderUsage } | undefined
let claudeTurn: { account: Promise<string>; usage: ProviderUsage } | undefined
let grokCache: { account: string; at: number; usage: ProviderUsage } | undefined

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

async function keychainPassword(service: string): Promise<string> {
  const child = Bun.spawn(['security', 'find-generic-password', '-s', service, '-w'], {
    stdout: 'pipe',
    stderr: 'ignore',
    signal: AbortSignal.timeout(2_000),
  })
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0) throw new Error(`no ${service} in the keychain`)
  return out
}

async function claudeCredentials(): Promise<Record<string, unknown>> {
  try {
    const credentials =
      platform() === 'darwin'
        ? await keychainPassword('Claude Code-credentials')
        : await readFile(join(homedir(), '.claude', '.credentials.json'), 'utf8')
    return object(object(JSON.parse(credentials)).claudeAiOauth)
  } catch {
    return {}
  }
}

// The signed-in account and organization (whose plan the limits are), and its email.
async function claudeAccount() {
  try {
    const config = object(JSON.parse(await readFile(join(homedir(), '.claude.json'), 'utf8')))
    const account = object(config.oauthAccount)
    const email = string(account.emailAddress)
    return {
      id: [account.accountUuid, account.organizationUuid, email].map(string).join('/'),
      email,
    }
  } catch {
    return { id: '', email: '' }
  }
}

// A turn reads its own usage, for whoever is signed in when it arrives.
export function noteClaudeTurnUsage(usage: ProviderUsage) {
  claudeTurn = { account: claudeAccount().then(({ id }) => id), usage }
}

export async function readClaudeProviderUsage(): Promise<ProviderUsage> {
  const oauth = await claudeCredentials()
  const token = string(oauth.accessToken)
  const plan = claudePlan(oauth.subscriptionType, oauth.rateLimitTier)
  const { id, email } = await claudeAccount()
  const metadata = { ...(plan ? { plan } : {}), ...(email ? { account: email } : {}) }
  if (!token) return { provider: 'claude', connected: false, windows: [], ...metadata }
  const usage = await readClaudeLimits(token, id)
  // A turn's own read is fresher than a cached or rate-limited OAuth one.
  const turn = claudeTurn && (await claudeTurn.account) === id ? claudeTurn.usage : undefined
  return turn?.windows.length && (turn.asOf ?? 0) > (usage.asOf ?? 0)
    ? { ...usage, connected: true, windows: turn.windows, asOf: turn.asOf, ...metadata }
    : { ...usage, ...metadata }
}

async function readClaudeLimits(token: string, account: string): Promise<ProviderUsage> {
  const cached = claudeCache?.account === account ? claudeCache : undefined
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.usage
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(4_000),
    })
    if (!response.ok) throw new Error('Claude usage unavailable')
    const windows = claudeUsageWindows(await response.json())
    if (windows.length === 0) throw new Error('Claude usage unavailable')
    const usage: ProviderUsage = { provider: 'claude', connected: true, windows, asOf: Date.now() }
    claudeCache = { account, at: Date.now(), usage }
    return usage
  } catch {
    return {
      ...(cached?.usage ?? { provider: 'claude', connected: true, windows: [] }),
      failed: true,
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
          failed: true,
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
      Effect.succeed({
        provider: 'codex',
        connected: false,
        windows: [],
        failed: true,
      } satisfies ProviderUsage)
    )
  )
}

export async function readGrokProviderUsage(): Promise<ProviderUsage> {
  // Grok runs on the key (grok-rpc.ts), which has no plan limits.
  if (process.env.XAI_API_KEY) return { provider: 'grok', connected: true, windows: [] }
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
  const id = [credential.user_id, credential.team_id, account].map(string).join('/')
  const cached = grokCache?.account === id ? grokCache : undefined
  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached.usage, ...metadata }
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
    grokCache = { account: id, at: Date.now(), usage }
    return usage
  } catch {
    return {
      ...(cached?.usage ?? { provider: 'grok', connected: true, windows: [] }),
      ...metadata,
      failed: true,
    }
  }
}

import type { ProviderUsage, UsageWindow } from '@jetty/shared/wire'

import { query, type AccountInfo, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { claudeBin } from './claude-bin'
import { openCodexConnection } from './codex-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'
import { readUsage } from './usage'

// Each read is kept for the account it was read for; signing in as another starts afresh.
const CACHE_MS = 60_000
// Model discovery uses the same budget. The wait is the Claude Code process, not the usage read.
const CLAUDE_USAGE_PROBE_MS = 20_000
let claudeCache: { account: string; at: number; usage: ProviderUsage } | undefined
let claudeTurn: ProviderUsage | undefined
let claudeRefresh: Promise<ProviderUsage> | undefined
let grokCache: { account: string; at: number; usage: ProviderUsage } | undefined

function capitalized(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function claudePlan(subscription: unknown, tier: string): string | undefined {
  const value = string(subscription).toLowerCase()
  if (!value) return undefined
  if (value !== 'max') return capitalized(value)
  const limit = tier.toLowerCase()
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

export function claudeUsageIdentity(account: Record<string, unknown>) {
  const user = string(account.accountUuid)
  const organization = string(account.organizationUuid)
  if (!user || !organization) return undefined
  return createHash('sha256')
    .update(JSON.stringify([user, organization]))
    .digest('hex')
}

// The signed-in account and organization (whose plan the limits are), and its email.
async function claudeAccount() {
  try {
    const config = object(JSON.parse(await readFile(join(homedir(), '.claude.json'), 'utf8')))
    const account = object(config.oauthAccount)
    const email = string(account.emailAddress)
    return {
      id: claudeUsageIdentity(account) ?? '',
      email,
      // What the SDK's AccountInfo.organization carries: the name, not the UUID.
      organization: string(account.organizationName),
      // Not in the SDK's usage read, which says only "max".
      tier: string(account.userRateLimitTier) || string(account.organizationRateLimitTier),
    }
  } catch {
    return { id: '', email: '', organization: '', tier: '' }
  }
}

export async function readClaudePlan(subscription: unknown) {
  return claudePlan(subscription, (await claudeAccount()).tier)
}

export async function readClaudeUsageIdentity(authenticated?: AccountInfo) {
  const account = await claudeAccount()
  if (
    authenticated &&
    (!account.email ||
      authenticated.email !== account.email ||
      (authenticated.organization ?? '') !== account.organization)
  )
    return undefined
  return account.id || undefined
}

export function noteClaudeTurnUsage(usage: ProviderUsage) {
  if (usage.identity) claudeTurn = usage
}

function accountFields(account: { id: string; email: string }) {
  return {
    ...(account.email ? { account: account.email } : {}),
    ...(account.id ? { identity: account.id } : {}),
  }
}

// Ends on abort without yielding a message, so the session never sends a turn.
function idlePrompt(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise((resolve) => {
          if (signal.aborted) {
            resolve({ done: true, value: undefined })
            return
          }
          signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), {
            once: true,
          })
        }),
    }),
  }
}

async function probeClaudeUsage(identity?: string): Promise<ProviderUsage | null> {
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), CLAUDE_USAGE_PROBE_MS)
  const session = query({
    prompt: idlePrompt(abortController.signal),
    options: {
      abortController,
      pathToClaudeCodeExecutable: claudeBin,
      persistSession: false,
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
    },
  })
  try {
    return await Promise.race([
      readUsage(session, identity),
      new Promise<null>((resolve) => {
        abortController.signal.addEventListener('abort', () => resolve(null), { once: true })
      }),
    ])
  } finally {
    clearTimeout(timer)
    // close() kills the process while the prompt is still open. Abort then unblocks it.
    try {
      session.close()
    } catch {
      // Already gone.
    }
    abortController.abort()
  }
}

// A sign-in switch rewrites the account file on its own, so a read that saw the account
// change around the probe may be one account's limits under the other's name: it's dropped.
export function readClaudeProviderUsage(): Promise<ProviderUsage> {
  claudeRefresh ??= readClaudeProviderUsageOnce().finally(() => {
    claudeRefresh = undefined
  })
  return claudeRefresh
}

async function readClaudeProviderUsageOnce(): Promise<ProviderUsage> {
  const before = await claudeAccount()
  const same = (account: { id: string; email: string }) =>
    account.id === before.id && account.email === before.email
  const unsure: ProviderUsage = { provider: 'claude', connected: true, windows: [], failed: true }
  const signedIn = Boolean(before.id || before.email)
  const cached = before.id && claudeCache?.account === before.id ? claudeCache : undefined
  let usage: ProviderUsage
  let probed: ProviderUsage | null = null
  if (!signedIn) usage = { provider: 'claude', connected: false, windows: [] }
  else if (cached && Date.now() - cached.at < CACHE_MS) usage = cached.usage
  else {
    probed = await probeClaudeUsage(before.id || undefined).catch(() => null)
    usage = probed ?? {
      ...(cached?.usage ?? { provider: 'claude', connected: true, windows: [] }),
      failed: true,
    }
  }
  const after = await claudeAccount()
  if (!same(after)) return unsure
  if (probed && before.id)
    claudeCache = { account: before.id, at: probed.asOf ?? Date.now(), usage: probed }
  // A turn's own read is fresher than a cached or failed probe, so a failed probe under it
  // isn't a failed refresh.
  const turn = after.id && claudeTurn?.identity === after.id ? claudeTurn : undefined
  const metadata = accountFields(after)
  if (!turn?.windows.length || (turn.asOf ?? 0) <= (usage.asOf ?? 0))
    return { ...usage, ...metadata }
  const { failed: _, ...read } = usage
  return { ...read, connected: true, windows: turn.windows, asOf: turn.asOf, ...metadata }
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

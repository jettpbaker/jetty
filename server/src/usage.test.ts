import type { Query, SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { claudeUsageIdentity } from './provider-usage'
import { readUsage } from './usage'

type FakeResponse = Awaited<
  ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>
>

function fakeQuery(
  impl: Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']
): Query {
  return {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: impl,
    accountInfo: async () => ({ email: 'account@example.com', organization: 'org' }),
  } as unknown as Query
}

function windows(overrides: Partial<NonNullable<SDKControlGetUsageResponse['rate_limits']>> = {}) {
  return {
    five_hour: { utilization: 42, resets_at: '2026-09-07T12:00:00.000Z' },
    seven_day: { utilization: 18, resets_at: '2026-09-10T00:00:00.000Z' },
    ...overrides,
  }
}

function baseResponse(overrides: Partial<FakeResponse> = {}): FakeResponse {
  return {
    session: {
      total_cost_usd: 0,
      total_api_duration_ms: 0,
      total_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      model_usage: {},
    },
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: windows(),
    behaviors: null,
    ...overrides,
  }
}

describe('readUsage', () => {
  test('maps the 5h and weekly windows', async () => {
    const usage = await readUsage(fakeQuery(async () => baseResponse()))
    expect(usage).not.toBeNull()
    expect(usage!.provider).toBe('claude')
    expect(usage!.connected).toBe(true)
    expect(usage!.plan).toStartWith('Max')
    expect(usage!.windows).toEqual([
      {
        id: 'five-hour',
        label: '5-hour',
        pct: 42,
        minutes: 300,
        resetsAt: Date.parse('2026-09-07T12:00:00.000Z'),
      },
      {
        id: 'seven-day',
        label: 'Weekly',
        pct: 18,
        minutes: 10_080,
        resetsAt: Date.parse('2026-09-10T00:00:00.000Z'),
      },
    ])
  })

  test('returns null when rate limits are unavailable', async () => {
    const usage = await readUsage(
      fakeQuery(async () =>
        baseResponse({
          rate_limits_available: false,
          rate_limits: null,
        })
      )
    )
    expect(usage).toBeNull()
  })
})

test('opaque Claude identities distinguish accounts and organizations and reject incomplete metadata', () => {
  const first = claudeUsageIdentity({ accountUuid: 'a', organizationUuid: 'org-1' })
  expect(first).toHaveLength(64)
  expect(claudeUsageIdentity({ accountUuid: 'a', organizationUuid: 'org-1' })).toBe(first)
  expect(claudeUsageIdentity({ accountUuid: 'a', organizationUuid: 'org-2' })).not.toBe(first)
  expect(claudeUsageIdentity({ accountUuid: 'b', organizationUuid: 'org-1' })).not.toBe(first)
  expect(claudeUsageIdentity({ accountUuid: 'a' })).toBeUndefined()
  expect(claudeUsageIdentity({})).toBeUndefined()
})

// The account check reads ~/.claude.json, which only a fresh process with HOME set can redirect.
async function readUsageSignedIn(script: string) {
  const home = mkdtempSync(join(tmpdir(), 'jetty-usage-'))
  try {
    const child = Bun.spawn([process.execPath, '-e', signedIn + script], {
      cwd: import.meta.dir,
      env: { ...process.env, HOME: home },
      stdout: 'pipe',
    })
    return JSON.parse(await new Response(child.stdout).text())
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const signedIn = `
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeUsageIdentity } from './provider-usage'
import { readUsage } from './usage'

function signIn(accountUuid) {
  const oauthAccount = { accountUuid, organizationUuid: 'org', emailAddress: 'account@example.com', organizationName: 'org' }
  writeFileSync(join(homedir(), '.claude.json'), JSON.stringify({ oauthAccount }))
}
function query(onRead) {
  return {
    accountInfo: async () => ({ email: 'account@example.com', organization: 'org' }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
      onRead()
      return { rate_limits_available: true, rate_limits: { five_hour: { utilization: 42 } } }
    },
  }
}
const accountA = claudeUsageIdentity({ accountUuid: 'a', organizationUuid: 'org' })
`

test('turn usage keeps its session identity and is discarded if credentials change during the read', async () => {
  const result = await readUsageSignedIn(`
    signIn('a')
    const unchanged = await readUsage(query(() => {}), accountA)
    const changed = await readUsage(query(() => signIn('b')), accountA)
    console.log(JSON.stringify([unchanged?.identity === accountA, changed]))
  `)
  expect(result).toEqual([true, null])
})

test('a warm session belonging to a prior account cannot attribute usage to the current account', async () => {
  const result = await readUsageSignedIn(`
    signIn('b')
    let requested = false
    const usage = await readUsage(query(() => { requested = true }), accountA)
    console.log(JSON.stringify([requested, usage]))
  `)
  expect(result).toEqual([false, null])
})

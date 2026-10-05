import type { Query, SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'

import { describe, expect, test } from 'bun:test'

import { readUsage } from './usage'

type FakeResponse = Awaited<
  ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>
>

function fakeQuery(
  impl: Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']
): Query {
  return { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: impl } as unknown as Query
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
    expect(usage!.plan).toBe('Max')
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

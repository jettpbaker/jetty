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
    expect(usage!.fiveHour.pct).toBe(42)
    expect(usage!.fiveHour.resetsAt).toBe(Date.parse('2026-09-07T12:00:00.000Z'))
    expect(usage!.sevenDay.pct).toBe(18)
    expect(usage!.extraUsage).toBeUndefined()
  })

  test('omits extraUsage when credits are disabled', async () => {
    const usage = await readUsage(
      fakeQuery(async () =>
        baseResponse({
          rate_limits: windows({
            extra_usage: {
              is_enabled: false,
              monthly_limit: 5000,
              used_credits: 1240,
              utilization: 24.8,
              currency: 'USD',
            },
          }),
        })
      )
    )
    expect(usage!.extraUsage).toBeUndefined()
  })

  test('maps enabled credits from cents to major units', async () => {
    const usage = await readUsage(
      fakeQuery(async () =>
        baseResponse({
          rate_limits: windows({
            extra_usage: {
              is_enabled: true,
              monthly_limit: 5000,
              used_credits: 1240,
              utilization: 24.8,
              currency: 'USD',
            },
          }),
        })
      )
    )
    expect(usage!.extraUsage).toEqual({
      used: 12.4,
      limit: 50,
      pct: 24.8,
      currency: 'USD',
    })
  })

  test('computes pct from used/limit when utilization is missing', async () => {
    const usage = await readUsage(
      fakeQuery(async () =>
        baseResponse({
          rate_limits: windows({
            extra_usage: {
              is_enabled: true,
              monthly_limit: 2000,
              used_credits: 763,
              utilization: null,
              currency: 'EUR',
            },
          }),
        })
      )
    )
    expect(usage!.extraUsage).toEqual({
      used: 7.63,
      limit: 20,
      pct: 38.15,
      currency: 'EUR',
    })
  })

  test('omits extraUsage when the monthly limit is unset', async () => {
    const usage = await readUsage(
      fakeQuery(async () =>
        baseResponse({
          rate_limits: windows({
            extra_usage: {
              is_enabled: true,
              monthly_limit: null,
              used_credits: 190,
              utilization: null,
              currency: 'USD',
            },
          }),
        })
      )
    )
    expect(usage!.extraUsage).toBeUndefined()
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

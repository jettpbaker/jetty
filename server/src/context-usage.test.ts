import type { Query } from '@anthropic-ai/claude-agent-sdk'

import { describe, expect, test } from 'bun:test'

import { readContextUsage } from './context-usage'

type FakeResponse = Awaited<ReturnType<Query['getContextUsage']>>

function fakeQuery(impl: Query['getContextUsage'] | undefined): Query {
  return { getContextUsage: impl } as unknown as Query
}

function baseResponse(overrides: Partial<FakeResponse> = {}): FakeResponse {
  return {
    categories: [
      { name: 'System prompt', tokens: 3248, color: '#fff' },
      { name: 'System tools', tokens: 11760, color: '#eee' },
      { name: 'Messages', tokens: 4200, color: '#ddd' },
      { name: 'Free space', tokens: 180_792, color: '#ccc' },
      { name: 'Empty', tokens: 0, color: '#bbb' },
    ],
    totalTokens: 19_208,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 9.6,
    gridRows: [],
    model: 'claude-sonnet-4',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    autoCompactThreshold: 180_000,
    isAutoCompactEnabled: true,
    apiUsage: null,
    ...overrides,
  }
}

describe('readContextUsage', () => {
  test('maps a happy-path SDK response', async () => {
    const before = Date.now()
    const usage = await readContextUsage(fakeQuery(async () => baseResponse()))
    expect(usage).not.toBeNull()
    expect(usage!.usedTokens).toBe(19_208)
    expect(usage!.maxTokens).toBe(200_000)
    expect(usage!.compactAt).toBe(180_000)
    expect(usage!.model).toBe('claude-sonnet-4')
    expect(usage!.asOf).toBeGreaterThanOrEqual(before)
    expect(usage!.slices).toEqual([
      { label: 'System prompt', tokens: 3248 },
      { label: 'System tools', tokens: 11760 },
      { label: 'Messages', tokens: 4200 },
    ])
  })

  test('drops Free space and zero-token categories', async () => {
    const usage = await readContextUsage(
      fakeQuery(async () =>
        baseResponse({
          categories: [
            { name: 'Messages', tokens: 100, color: '#fff' },
            { name: 'free space', tokens: 50_000, color: '#eee' },
            { name: 'FREE SPACE', tokens: 1, color: '#ddd' },
            { name: 'Scratch', tokens: -5, color: '#ccc' },
            { name: 'Zero', tokens: 0, color: '#bbb' },
          ],
          totalTokens: 100,
        })
      )
    )
    expect(usage!.slices).toEqual([{ label: 'Messages', tokens: 100 }])
  })

  test('clamps totalTokens above maxTokens', async () => {
    const usage = await readContextUsage(
      fakeQuery(async () =>
        baseResponse({
          totalTokens: 250_000,
          maxTokens: 200_000,
          categories: [{ name: 'Messages', tokens: 250_000, color: '#fff' }],
        })
      )
    )
    expect(usage!.usedTokens).toBe(200_000)
  })

  test('omits compactAt when auto-compact is off', async () => {
    const usage = await readContextUsage(
      fakeQuery(async () =>
        baseResponse({
          isAutoCompactEnabled: false,
          autoCompactThreshold: 180_000,
        })
      )
    )
    expect(usage!.compactAt).toBeUndefined()
  })

  test('returns null when the method throws', async () => {
    const usage = await readContextUsage(
      fakeQuery(async () => {
        throw new Error('Query closed before response received')
      })
    )
    expect(usage).toBeNull()
  })

  test('returns null when the method is missing', async () => {
    const usage = await readContextUsage(fakeQuery(undefined))
    expect(usage).toBeNull()
  })

  test('returns null when totalTokens <= 0', async () => {
    expect(
      await readContextUsage(fakeQuery(async () => baseResponse({ totalTokens: 0 })))
    ).toBeNull()
    expect(
      await readContextUsage(fakeQuery(async () => baseResponse({ totalTokens: -10 })))
    ).toBeNull()
  })
})

import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage } from '@jetty/shared/events'

import { describe, expect, test } from 'bun:test'

import {
  createContextPoller,
  readContextUsage,
  resolveContextWindow,
  sdkModelId,
} from './context-usage'

type FakeResponse = Awaited<ReturnType<Query['getContextUsage']>>

function fakeQuery(impl: Query['getContextUsage']): Query {
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

  test('usedTokens is the content sum, not a stale API total', async () => {
    const usage = await readContextUsage(
      fakeQuery(async () =>
        baseResponse({
          totalTokens: 180_000,
          categories: [
            { name: 'System prompt', tokens: 3_000, color: '#fff' },
            { name: 'Messages', tokens: 12_000, color: '#eee' },
            { name: 'Autocompact buffer', tokens: 33_000, color: '#ddd' },
            { name: 'Free space', tokens: 152_000, color: '#ccc' },
          ],
        })
      )
    )
    expect(usage!.usedTokens).toBe(15_000)
    expect(usage!.slices).toEqual([
      { label: 'System prompt', tokens: 3_000 },
      { label: 'Messages', tokens: 12_000 },
    ])
  })

  test('drops deferred categories from the used total', async () => {
    const usage = await readContextUsage(
      fakeQuery(async () =>
        baseResponse({
          totalTokens: 50_000,
          categories: [
            { name: 'System tools', tokens: 8_000, color: '#fff' },
            { name: 'MCP tools (deferred)', tokens: 40_000, color: '#eee', isDeferred: true },
          ],
        })
      )
    )
    expect(usage!.usedTokens).toBe(8_000)
    expect(usage!.slices).toEqual([{ label: 'System tools', tokens: 8_000 }])
  })

  test('prefers rawMaxTokens when the CLI splits the window', async () => {
    const usage = await readContextUsage(
      fakeQuery(async () =>
        baseResponse({
          maxTokens: 200_000,
          rawMaxTokens: 1_000_000,
          model: 'claude-sonnet-4-5',
        })
      )
    )
    expect(usage!.maxTokens).toBe(1_000_000)
  })

  test('lifts a 200k report to 1M for native-1M models', async () => {
    const usage = await readContextUsage(
      fakeQuery(async () =>
        baseResponse({
          maxTokens: 200_000,
          rawMaxTokens: 200_000,
          autoCompactThreshold: 167_000,
          model: 'claude-sonnet-5',
        })
      )
    )
    expect(usage!.maxTokens).toBe(1_000_000)
    expect(usage!.compactAt).toBe(835_000)
  })

  test('leaves Haiku and Sonnet 4.5 at 200k', async () => {
    const haiku = await readContextUsage(
      fakeQuery(async () => baseResponse({ model: 'claude-haiku-4-5-20251001' }))
    )
    expect(haiku!.maxTokens).toBe(200_000)
    const sonnet45 = await readContextUsage(
      fakeQuery(async () => baseResponse({ model: 'claude-sonnet-4-5' }))
    )
    expect(sonnet45!.maxTokens).toBe(200_000)
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

  test('returns null when there is no content and totalTokens <= 0', async () => {
    expect(
      await readContextUsage(
        fakeQuery(async () =>
          baseResponse({
            totalTokens: 0,
            categories: [{ name: 'Free space', tokens: 200_000, color: '#fff' }],
          })
        )
      )
    ).toBeNull()
    expect(
      await readContextUsage(
        fakeQuery(async () => baseResponse({ totalTokens: -10, categories: [] }))
      )
    ).toBeNull()
  })
})

describe('resolveContextWindow', () => {
  test('lifts known native-1M ids and [1m] suffixes', () => {
    expect(resolveContextWindow(200_000, 'claude-fable-5')).toBe(1_000_000)
    expect(resolveContextWindow(200_000, 'claude-opus-5')).toBe(1_000_000)
    expect(resolveContextWindow(200_000, 'claude-opus-4-8')).toBe(1_000_000)
    expect(resolveContextWindow(200_000, 'claude-sonnet-4-5[1m]')).toBe(1_000_000)
  })

  test('does not lift lookalike or 200k-native ids', () => {
    expect(resolveContextWindow(200_000, 'claude-sonnet-4-5')).toBe(200_000)
    expect(resolveContextWindow(200_000, 'claude-opus-4-5')).toBe(200_000)
    expect(resolveContextWindow(200_000, 'claude-haiku-4-5-20251001')).toBe(200_000)
  })

  test('honors CLAUDE_CODE_DISABLE_1M_CONTEXT', () => {
    const prev = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    try {
      expect(resolveContextWindow(200_000, 'claude-sonnet-5')).toBe(200_000)
      expect(sdkModelId('claude-opus-5')).toBe('claude-opus-5')
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
      else process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = prev
    }
  })
})

describe('sdkModelId', () => {
  test('tags opus-5 with [1m] so the CLI sees a 1M window', () => {
    expect(sdkModelId('claude-opus-5')).toBe('claude-opus-5[1m]')
    expect(sdkModelId('claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(sdkModelId('claude-opus-5[1m]')).toBe('claude-opus-5[1m]')
  })
})

function usageAt(usedTokens: number, maxTokens = 200_000): ContextUsage {
  return { usedTokens, maxTokens, slices: [], asOf: usedTokens }
}

/** Reads resolve only when the test says so, so a poll can be held in flight. */
function pollerHarness(startAt = 0) {
  const reads: ((usage: ContextUsage | null) => void)[] = []
  const emitted: ContextUsage[] = []
  let clock = startAt
  const poller = createContextPoller({
    read: () => new Promise<ContextUsage | null>((resolve) => reads.push(resolve)),
    emit: (usage) => emitted.push(usage),
    now: () => clock,
  })
  return {
    poller,
    reads,
    emitted,
    advance(ms: number) {
      clock += ms
    },
    async settle(index: number, usage: ContextUsage | null) {
      reads[index]!(usage)
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

describe('createContextPoller', () => {
  test('emits the first read', async () => {
    const h = pollerHarness()
    h.poller.poll()
    await h.settle(0, usageAt(20_000))
    expect(h.emitted).toEqual([usageAt(20_000)])
  })

  test('throttles unforced polls, force bypasses the throttle', async () => {
    const h = pollerHarness()
    h.poller.poll()
    await h.settle(0, usageAt(20_000))
    h.advance(100)
    h.poller.poll()
    expect(h.reads).toHaveLength(1)
    h.poller.poll(true)
    expect(h.reads).toHaveLength(2)
    h.advance(2500)
    h.poller.poll()
    expect(h.reads).toHaveLength(2) // the forced read is still in flight
  })

  test('a forced poll arriving mid-read still lands once the read settles', async () => {
    const h = pollerHarness()
    h.poller.poll()
    h.poller.poll(true)
    expect(h.reads).toHaveLength(1)

    await h.settle(0, usageAt(20_000))
    expect(h.reads).toHaveLength(2)

    await h.settle(1, usageAt(40_000))
    expect(h.emitted).toEqual([usageAt(20_000), usageAt(40_000)])
  })

  test('holds mid-turn reads until the number moves, force lowers the bar', async () => {
    const h = pollerHarness()
    h.poller.poll()
    await h.settle(0, usageAt(20_000))

    h.advance(2500)
    h.poller.poll()
    await h.settle(1, usageAt(20_400))
    expect(h.emitted).toHaveLength(1)

    h.poller.poll(true)
    await h.settle(2, usageAt(20_400))
    expect(h.emitted).toHaveLength(2)
  })

  test('an unmoved number is never emitted twice, even forced', async () => {
    const h = pollerHarness()
    h.poller.poll()
    await h.settle(0, usageAt(20_000))
    h.poller.poll(true)
    await h.settle(1, usageAt(20_000))
    expect(h.emitted).toHaveLength(1)
  })

  test('a changed window emits even when the total is unmoved', async () => {
    const h = pollerHarness()
    h.poller.poll()
    await h.settle(0, usageAt(20_000, 200_000))
    h.poller.poll(true)
    await h.settle(1, usageAt(20_000, 1_000_000))
    expect(h.emitted).toEqual([usageAt(20_000, 200_000), usageAt(20_000, 1_000_000)])
  })

  test('a changed compact threshold emits even when the total is unmoved', async () => {
    const h = pollerHarness()
    const first = { ...usageAt(20_000), compactAt: 180_000 }
    const second = { ...usageAt(20_000), compactAt: 835_000 }
    h.poller.poll()
    await h.settle(0, first)
    h.poller.poll(true)
    await h.settle(1, second)
    expect(h.emitted).toEqual([first, second])
  })

  test('stop suppresses a read that resolves after the session closed', async () => {
    const h = pollerHarness()
    h.poller.poll()
    h.poller.stop()
    await h.settle(0, usageAt(20_000))
    expect(h.emitted).toHaveLength(0)
    h.poller.poll(true)
    expect(h.reads).toHaveLength(1)
  })

  test('a failed read neither emits nor wedges the next poll', async () => {
    const h = pollerHarness()
    h.poller.poll()
    await h.settle(0, null)
    expect(h.emitted).toHaveLength(0)
    h.poller.poll(true)
    await h.settle(1, usageAt(20_000))
    expect(h.emitted).toEqual([usageAt(20_000)])
  })
})

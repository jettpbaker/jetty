import type { ProviderUsage } from '@jetty/shared/wire'

import { expect, test } from 'bun:test'

import { lastGood } from '../src/lib/provider-usage'

const previous: ProviderUsage = {
  provider: 'claude',
  connected: true,
  account: 'same@example.com',
  identity: 'organization-a',
  windows: [{ id: 'five-hour', label: '5-hour', pct: 42 }],
  asOf: 123,
}

function failed(identity?: string): ProviderUsage {
  return { ...previous, windows: [], failed: true, identity }
}

test('failed usage restores only windows with the same opaque account and organization identity', () => {
  expect(lastGood(previous, failed('organization-a')).windows).toEqual(previous.windows)
  expect(lastGood(previous, failed('organization-a')).asOf).toBe(123)
  expect(lastGood(previous, failed('organization-b')).windows).toEqual([])
  expect(lastGood(previous, failed()).windows).toEqual([])
  expect(lastGood({ ...previous, identity: undefined }, failed()).windows).toEqual([])
})

test('failed Codex and Grok usage, which carry no identity, restore the same account’s windows', () => {
  const codex = { ...previous, provider: 'codex' as const, identity: undefined }
  expect(lastGood(codex, { ...failed(), provider: 'codex' }).windows).toEqual(previous.windows)
  expect(
    lastGood(codex, { ...failed(), provider: 'codex', account: 'other@example.com' }).windows
  ).toEqual([])
})

import { loadProviderEnabled } from '@/lib/provider-enabled'
import { lastGood } from '@/lib/provider-usage'
import { storage } from '@/platform'
import { useAtomValue } from '@effect/atom-react'
import { ProviderUsage } from '@jetty/shared/wire'
import { Effect, Schema } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useCallback } from 'react'

import { run, useAction } from './connection'

export type UsageProvider = ProviderUsage['provider']
const UsageRead = Schema.Struct({ usage: ProviderUsage, at: Schema.Finite })
export type UsageRead = Schema.Schema.Type<typeof UsageRead>
export type UsageReads = Partial<Record<UsageProvider, UsageRead>>
export const allUsageProviders: readonly UsageProvider[] = ['claude', 'codex', 'grok']

// The providers Usage shows: those not switched off in Settings.
export function usageProviders() {
  const enabled = loadProviderEnabled()
  return allUsageProviders.filter((provider) => enabled[provider])
}

// Each provider's last read survives reloads, so Usage and /usage open on it while a fresh read
// catches up. Providers are read separately: a slow one (Codex starts its app-server) never holds
// up the others. Reads start only when Usage is pointed at or opened, /usage runs, or Settings
// shows the providers: never at launch or in the background, where they'd cost every launch a
// child process for a page most never open.
const cacheKey = 'jetty.provider-usage'
const isRead = Schema.is(UsageRead)

function loadCached() {
  const reads: UsageReads = {}
  try {
    const saved: unknown = JSON.parse(storage.get(cacheKey) ?? '{}')
    const values: unknown[] = saved && typeof saved === 'object' ? Object.values(saved) : []
    for (const read of values) if (isRead(read)) reads[read.usage.provider] = read
  } catch {}
  return reads
}

const readsAtom = Atom.make<UsageReads>(loadCached()).pipe(Atom.keepAlive)
const loadingAtom = Atom.make(new Set<UsageProvider>()).pipe(Atom.keepAlive)
const failedAtom = Atom.make(new Set<UsageProvider>()).pipe(Atom.keepAlive)

// A read this recent is good enough to open on; pointing at Usage or opening it refreshes older ones.
export const usageFreshMs = 30_000
// The server gives up on a provider within 8s; a read still unanswered well past that has hung,
// and would otherwise hold the provider "loading", skipped by every refresh, for the page's life.
const readTimeout = '20 seconds'

// The same set when nothing changes, so a read that settles as expected re-renders nothing.
function toggled(set: Set<UsageProvider>, provider: UsageProvider, present: boolean) {
  if (set.has(provider) === present) return set
  const next = new Set(set)
  if (present) next.add(provider)
  else next.delete(provider)
  return next
}

function readProviderUsage(registry: AtomRegistry.AtomRegistry, provider: UsageProvider) {
  registry.set(loadingAtom, toggled(registry.get(loadingAtom), provider, true))
  const settle = (failed: boolean) => {
    registry.set(loadingAtom, toggled(registry.get(loadingAtom), provider, false))
    registry.set(failedAtom, toggled(registry.get(failedAtom), provider, failed))
  }
  run(
    registry,
    (connection) =>
      connection.request('settings.providerUsage', { provider }).pipe(
        Effect.timeout(readTimeout),
        Effect.tap((usage) =>
          Effect.sync(() => {
            const previous = registry.get(readsAtom)[provider]?.usage
            const reads = {
              ...registry.get(readsAtom),
              [provider]: { usage: lastGood(previous, usage), at: Date.now() },
            }
            registry.set(readsAtom, reads)
            storage.set(cacheKey, JSON.stringify(reads))
            settle(false)
          })
        )
      ),
    () => settle(true)
  )
}

// Reads each provider not already in flight whose last read is older than maxAge (0: always).
function refreshProviderUsage(
  registry: AtomRegistry.AtomRegistry,
  providers: readonly UsageProvider[],
  maxAge = 0
) {
  const reads = registry.get(readsAtom)
  for (const provider of providers) {
    const at = reads[provider]?.at
    if (registry.get(loadingAtom).has(provider)) continue
    if (maxAge > 0 && at !== undefined && Date.now() - at < maxAge) continue
    readProviderUsage(registry, provider)
  }
}

export function useProviderUsage() {
  return {
    reads: useAtomValue(readsAtom),
    loading: useAtomValue(loadingAtom),
    failed: useAtomValue(failedAtom),
    refresh: useAction(refreshProviderUsage),
  }
}

// Starts reads without re-rendering on their results.
export function useRefreshProviderUsage() {
  return useAction(refreshProviderUsage)
}

// For pointing at Usage: starts any read that isn't fresh.
export function usePrefetchProviderUsage() {
  const refresh = useRefreshProviderUsage()
  return useCallback(() => refresh(usageProviders(), usageFreshMs), [refresh])
}

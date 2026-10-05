import { loadProviderEnabled } from '@/lib/provider-enabled'
import { storage } from '@/platform'
import { useAtomValue } from '@effect/atom-react'
import { ProviderUsage } from '@jetty/shared/wire'
import { Effect, Schema } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useCallback, useEffect } from 'react'

import { run, useAction } from './connection'

export type UsageProvider = ProviderUsage['provider']
const UsageRead = Schema.Struct({ usage: ProviderUsage, at: Schema.Finite })
export type UsageRead = Schema.Schema.Type<typeof UsageRead>
export type UsageReads = Partial<Record<UsageProvider, UsageRead>>
export const allUsageProviders: readonly UsageProvider[] = ['claude', 'codex', 'grok']

// The providers Usage shows and keeps warm: those not switched off in Settings.
export function usageProviders() {
  const enabled = loadProviderEnabled()
  return allUsageProviders.filter((provider) => enabled[provider])
}

// Each provider's last read survives reloads, so Usage and /usage open on it while a fresh read
// catches up. Providers are read separately: a slow one (Codex starts its app-server) never holds
// up the others.
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
// Kept warm in the background at this cadence, while the window is visible.
const warmMs = 5 * 60_000

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
        Effect.tap((usage) =>
          Effect.sync(() => {
            const reads = { ...registry.get(readsAtom), [provider]: { usage, at: Date.now() } }
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

// Mounted once, for the app's life: Usage and /usage then open on a read minutes old at most.
export function useWarmProviderUsage() {
  const refresh = useAction(refreshProviderUsage)
  useEffect(() => {
    function warm() {
      if (document.visibilityState === 'visible') refresh(usageProviders(), usageFreshMs)
    }
    function returned() {
      if (document.visibilityState === 'visible') refresh(usageProviders(), warmMs)
    }
    warm()
    const timer = window.setInterval(warm, warmMs)
    document.addEventListener('visibilitychange', returned)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', returned)
    }
  }, [refresh])
}

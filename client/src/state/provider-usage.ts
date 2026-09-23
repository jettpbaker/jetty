import type { ProviderUsage } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'

import { run, useAction } from './connection'

const usageAtom = Atom.make<readonly ProviderUsage[]>([]).pipe(Atom.keepAlive)
const loadingAtom = Atom.make(false).pipe(Atom.keepAlive)
const loadedAtom = Atom.make(false).pipe(Atom.keepAlive)
const failedAtom = Atom.make(false).pipe(Atom.keepAlive)

function refreshProviderUsage(registry: AtomRegistry.AtomRegistry) {
  if (registry.get(loadingAtom)) return
  registry.set(loadingAtom, true)
  registry.set(failedAtom, false)
  run(
    registry,
    (connection) =>
      connection.request('settings.providerUsage', {}).pipe(
        Effect.tap((usage) =>
          Effect.sync(() => {
            registry.set(usageAtom, usage)
            registry.set(loadedAtom, true)
          })
        ),
        Effect.ensuring(Effect.sync(() => registry.set(loadingAtom, false)))
      ),
    () => {
      registry.set(loadingAtom, false)
      registry.set(loadedAtom, true)
      registry.set(failedAtom, true)
    }
  )
}

export function useProviderUsage() {
  return {
    usage: useAtomValue(usageAtom),
    loading: useAtomValue(loadingAtom),
    loaded: useAtomValue(loadedAtom),
    failed: useAtomValue(failedAtom),
    refresh: useAction(refreshProviderUsage),
  }
}

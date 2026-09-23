import { restoreLoadouts, type LoadoutSlot } from '@/lib/loadout'
import { storage } from '@/platform'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

import { modelsAtom } from './chrome'

const key = 'jetty.loadout'

function loadStored(): unknown {
  try {
    return JSON.parse(storage.get(key) ?? 'null')
  } catch {
    return null
  }
}

const storedAtom = Atom.make(loadStored()).pipe(Atom.keepAlive)

export const loadoutsAtom = Atom.readable((get) =>
  restoreLoadouts(get(storedAtom), get(modelsAtom))
)

export function useLoadouts() {
  const registry = useContext(RegistryContext)
  const loadouts = useAtomValue(loadoutsAtom)
  const catalog = useAtomValue(modelsAtom)
  const setLoadouts = useCallback(
    (next: readonly LoadoutSlot[]) => {
      registry.set(storedAtom, next)
      storage.set(key, JSON.stringify(next))
    },
    [registry]
  )
  return { loadouts, catalog, setLoadouts }
}

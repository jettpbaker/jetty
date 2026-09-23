import { restoreLoadouts, type LoadoutSlot } from '@/lib/loadout'
import { storage } from '@/platform'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

import { modelsAtom } from './chrome'

const key = 'jetty.loadout'
const modelEnabledKey = 'jetty.model-enabled'

function loadModelEnabled(): Record<string, boolean> {
  try {
    const saved: unknown = JSON.parse(storage.get(modelEnabledKey) ?? '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(
      Object.entries(saved).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
      )
    )
  } catch {
    return {}
  }
}

const modelEnabledAtom = Atom.make(loadModelEnabled()).pipe(Atom.keepAlive)

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
  const allModels = useAtomValue(modelsAtom)
  const modelEnabled = useAtomValue(modelEnabledAtom)
  const catalog = allModels.filter(
    (model) => modelEnabled[`${model.provider}:${model.id}`] !== false
  )
  const setLoadouts = useCallback(
    (next: readonly LoadoutSlot[]) => {
      registry.set(storedAtom, next)
      return storage.set(key, JSON.stringify(next))
    },
    [registry]
  )
  return { loadouts, catalog, setLoadouts }
}

export function useModelAvailability() {
  const registry = useContext(RegistryContext)
  const catalog = useAtomValue(modelsAtom)
  const enabled = useAtomValue(modelEnabledAtom)
  const setEnabled = useCallback(
    (model: { provider: string; id: string }, checked: boolean) => {
      const next = { ...registry.get(modelEnabledAtom), [`${model.provider}:${model.id}`]: checked }
      registry.set(modelEnabledAtom, next)
      storage.set(modelEnabledKey, JSON.stringify(next))
    },
    [registry]
  )
  return { catalog, enabled, setEnabled }
}

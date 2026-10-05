import { findModel, restoreLoadouts, type LoadoutSlot } from '@/lib/loadout'
import {
  loadProviderEnabled,
  saveProviderEnabled,
  type ProviderEnabled,
} from '@/lib/provider-enabled'
import { storage } from '@/platform'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/reactivity'
import { useCallback, useContext } from 'react'

import { chromeAtom, modelsAtom } from './chrome'

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
const providerEnabledAtom = Atom.make(loadProviderEnabled()).pipe(Atom.keepAlive)

export const enabledModelsAtom = Atom.readable((get) => {
  const providers = get(providerEnabledAtom)
  const enabled = get(modelEnabledAtom)
  return get(modelsAtom).filter(
    (model) => providers[model.provider] && enabled[`${model.provider}:${model.id}`] !== false
  )
})

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

// The slots a send can use: not one whose provider or model is switched off, or whose model left
// the catalog once its provider's discovery finished.
export const usableLoadoutsAtom = Atom.readable((get) => {
  const catalog = get(enabledModelsAtom)
  const providers = get(providerEnabledAtom)
  const discovery = get(chromeAtom)?.modelDiscovery
  return get(loadoutsAtom).filter(
    (slot) =>
      slot.model !== null &&
      (findModel(catalog, slot) !== undefined ||
        (providers[slot.provider] && discovery?.[slot.provider] !== 'ready'))
  )
})

export function useLoadouts() {
  const registry = useContext(RegistryContext)
  const loadouts = useAtomValue(loadoutsAtom)
  const usable = useAtomValue(usableLoadoutsAtom)
  const catalog = useAtomValue(enabledModelsAtom)
  const setLoadouts = useCallback(
    (next: readonly LoadoutSlot[]) => {
      registry.set(storedAtom, next)
      return storage.set(key, JSON.stringify(next))
    },
    [registry]
  )
  return { loadouts, usable, catalog, setLoadouts }
}

export function useProviderEnabled() {
  const registry = useContext(RegistryContext)
  const enabled = useAtomValue(providerEnabledAtom)
  const setEnabled = useCallback(
    (next: ProviderEnabled) => {
      registry.set(providerEnabledAtom, next)
      saveProviderEnabled(next)
    },
    [registry]
  )
  return [enabled, setEnabled] as const
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

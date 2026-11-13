import type { PermissionMode, ProviderId } from '@jetty/shared/wire'

import { storage } from '@/platform'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useCallback, useContext } from 'react'

import { chromeAtom, threadMetaAtom } from './chrome'
import { run, useAction } from './connection'
import { awaitCreation, clearPatch, setPatch, settlePatch } from './mutations'

type Registry = AtomRegistry.AtomRegistry
type Defaults = Partial<Record<ProviderId, PermissionMode>>

const key = 'jetty.accessMode'

// Each provider's mode for new threads. Builds before per-provider defaults saved one for all of
// them, which still stands in for a provider not set since.
function storedDefault(provider: ProviderId): PermissionMode {
  return (storage.get(`${key}.${provider}`) ?? storage.get(key)) === 'full_access'
    ? 'full_access'
    : 'auto'
}

const defaultsAtom = Atom.make<Defaults>({}).pipe(Atom.keepAlive)

function defaultFor(defaults: Defaults, provider: ProviderId | undefined): PermissionMode {
  return provider ? (defaults[provider] ?? storedDefault(provider)) : 'auto'
}

// A thread runs in its own mode; one not started yet takes its provider's default.
export function accessFor(
  registry: Registry,
  threadId: string,
  provider: ProviderId | undefined
): PermissionMode {
  const thread = registry.get(chromeAtom)?.threads.find((entry) => entry.id === threadId)
  return thread?.permissionMode ?? defaultFor(registry.get(defaultsAtom), provider)
}

export function useAccessDefault(provider: ProviderId | undefined) {
  const registry = useContext(RegistryContext)
  const accessMode = defaultFor(useAtomValue(defaultsAtom), provider)
  const setAccessMode = useCallback(
    (next: PermissionMode) => {
      if (!provider) return
      storage.set(`${key}.${provider}`, next)
      registry.update(defaultsAtom, (defaults) => ({ ...defaults, [provider]: next }))
    },
    [provider, registry]
  )
  return { accessMode, setAccessMode }
}

function setThreadAccess(registry: Registry, threadId: string, permissionMode: PermissionMode) {
  setPatch(registry, threadId, { permissionMode })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(
          connection.request('thread.setPermissionMode', { threadId, permissionMode })
        ),
        Effect.tap(() =>
          Effect.sync(() => settlePatch(registry, threadId, 'permissionMode', permissionMode))
        )
      ),
    () => clearPatch(registry, threadId, 'permissionMode', permissionMode)
  )
}

// The shield: an existing thread's own mode, or on a new thread its provider's default.
export function useAccessMode(threadId: string | undefined, provider: ProviderId | undefined) {
  const own = useAtomValue(threadMetaAtom(threadId ?? ''))?.permissionMode
  const { accessMode, setAccessMode: setDefault } = useAccessDefault(provider)
  const setThread = useAction(setThreadAccess)
  const setAccessMode = useCallback(
    (next: PermissionMode) => {
      if (threadId && own) setThread(threadId, next)
      else setDefault(next)
    },
    [own, setDefault, setThread, threadId]
  )
  return { accessMode: own ?? accessMode, setAccessMode }
}

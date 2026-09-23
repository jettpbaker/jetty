import type { PermissionMode } from '@jetty/shared/wire'

import { storage } from '@/platform'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

const key = 'jetty.accessMode'

function loadAccessMode(): PermissionMode {
  return storage.get(key) === 'full_access' ? 'full_access' : 'auto'
}

export const accessModeAtom = Atom.make(loadAccessMode()).pipe(Atom.keepAlive)

export function useAccessMode() {
  const registry = useContext(RegistryContext)
  const accessMode = useAtomValue(accessModeAtom)
  const setAccessMode = useCallback(
    (next: PermissionMode) => {
      storage.set(key, next)
      registry.set(accessModeAtom, next)
    },
    [registry]
  )
  return { accessMode, setAccessMode }
}

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

export const MAIN_TAB = 'main'

const threadTabAtom = Atom.family((_threadId: string) =>
  Atom.make<string>(MAIN_TAB).pipe(Atom.keepAlive)
)

export function useThreadTab(threadId: string) {
  const registry = useContext(RegistryContext)
  const tab = useAtomValue(threadTabAtom(threadId))
  const setTab = useCallback(
    (next: string) => registry.set(threadTabAtom(threadId), next),
    [registry, threadId]
  )
  return [tab, setTab] as const
}

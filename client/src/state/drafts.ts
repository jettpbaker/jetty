import type { ComposerImage } from '@/hooks/use-image-attachments'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

// The unsent composer state of one thread; the new-thread composer uses the key ''.
export type Draft = {
  text: string
  images: readonly ComposerImage[]
  // the queued message this draft rewrites
  editing?: string
}

const emptyDraft: Draft = { text: '', images: [] }

const draftAtom = Atom.family((_key: string) => Atom.make<Draft>(emptyDraft).pipe(Atom.keepAlive))

export function useDraft(key: string) {
  const registry = useContext(RegistryContext)
  const draft = useAtomValue(draftAtom(key))
  const update = useCallback(
    (patch: Partial<Draft>) =>
      registry.update(draftAtom(key), (current) => ({ ...current, ...patch })),
    [key, registry]
  )
  // the latest draft, for work that finishes after a render
  const read = useCallback(() => registry.get(draftAtom(key)), [key, registry])
  return { draft, update, read }
}

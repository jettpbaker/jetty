import type { ComposerImage } from '@/hooks/use-image-attachments'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

// The unsent composer state of one thread; the new-thread composer uses the key ''.
export type Draft = {
  text: string
  images: readonly ComposerImage[]
  // the queued message this draft rewrites
  editing?: string
}

const emptyDraft: Draft = { text: '', images: [] }

const draftsAtom = Atom.make<ReadonlyMap<string, Draft>>(new Map()).pipe(Atom.keepAlive)

const draftAtom = Atom.family((key: string) =>
  Atom.make((get) => get(draftsAtom).get(key) ?? emptyDraft)
)

// Each thread whose draft is rewriting a queued message, with that message's id.
export function editingDrafts(registry: AtomRegistry.AtomRegistry) {
  const editing: [threadId: string, messageId: string][] = []
  for (const [key, draft] of registry.get(draftsAtom))
    if (key && draft.editing) editing.push([key, draft.editing])
  return editing
}

export function useDraft(key: string) {
  const registry = useContext(RegistryContext)
  const draft = useAtomValue(draftAtom(key))
  const update = useCallback(
    (patch: Partial<Draft>) =>
      registry.update(draftsAtom, (drafts) =>
        new Map(drafts).set(key, { ...(drafts.get(key) ?? emptyDraft), ...patch })
      ),
    [key, registry]
  )
  // the latest draft, for work that finishes after a render
  const read = useCallback(() => registry.get(draftAtom(key)), [key, registry])
  return { draft, update, read }
}

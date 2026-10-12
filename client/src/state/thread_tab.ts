import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/reactivity'
import { useCallback, useContext } from 'react'

// A one-shot request for the chat to scroll a row into view; the list clears it once handled.
const revealAtom = Atom.family((_threadId: string) =>
  Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)
)

export function useRevealRow(threadId: string) {
  const registry = useContext(RegistryContext)
  const rowId = useAtomValue(revealAtom(threadId))
  const clear = useCallback(
    () => registry.set(revealAtom(threadId), undefined),
    [registry, threadId]
  )
  return [rowId, clear] as const
}

export function useRequestReveal() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, rowId: string) => {
      registry.set(revealAtom(threadId), rowId)
    },
    [registry]
  )
}

// Asks a thread's details pane to open on a tab; the pane consumes it once mounted.
type DetailsRequest = { threadId: string; tab: string }

export const detailsRequestAtom = Atom.make<DetailsRequest | undefined>(undefined).pipe(
  Atom.keepAlive
)

export function useDetailsRequest(threadId: string) {
  const registry = useContext(RegistryContext)
  const request = useAtomValue(detailsRequestAtom)
  const consume = useCallback(() => registry.set(detailsRequestAtom, undefined), [registry])
  return { tab: request?.threadId === threadId ? request.tab : undefined, consume }
}

// A one-shot request for the overview to open a section and scroll it into view; the overview
// clears it once handled.
const sectionRevealAtom = Atom.family((_threadId: string) =>
  Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)
)

export function useRevealSection(threadId: string) {
  const registry = useContext(RegistryContext)
  const section = useAtomValue(sectionRevealAtom(threadId))
  const clear = useCallback(
    () => registry.set(sectionRevealAtom(threadId), undefined),
    [registry, threadId]
  )
  return [section, clear] as const
}

export function useRequestSectionReveal() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, section: string) => {
      registry.set(detailsRequestAtom, { threadId, tab: 'overview' })
      registry.set(sectionRevealAtom(threadId), section)
    },
    [registry]
  )
}

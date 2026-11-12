import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/reactivity'
import { useCallback, useContext } from 'react'

// A one-shot request per thread, which whoever handles it clears.
function oneShotFamily() {
  return Atom.family((_threadId: string) =>
    Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)
  )
}

function useOneShot(atom: Atom.Writable<string | undefined>) {
  const registry = useContext(RegistryContext)
  const value = useAtomValue(atom)
  const clear = useCallback(() => registry.set(atom, undefined), [registry, atom])
  return [value, clear] as const
}

// For the chat to scroll a row into view; the list clears it once handled.
const revealAtom = oneShotFamily()

export function useRevealRow(threadId: string) {
  return useOneShot(revealAtom(threadId))
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

// For the overview to open a section and scroll it into view; the overview clears it once
// handled.
const sectionRevealAtom = oneShotFamily()

export function useRevealSection(threadId: string) {
  return useOneShot(sectionRevealAtom(threadId))
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

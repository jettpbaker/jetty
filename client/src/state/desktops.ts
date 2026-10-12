import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Equal } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useCallback, useContext, useMemo } from 'react'

import { chromeAtom, threadMetaAtom } from './chrome'
import { useAction } from './connection'
import { detailsRequestAtom } from './thread_tab'

// A desktop lives on the thread whose agent started it; one no thread has any more has ended.
export type Desktop = { threadId?: string; state: 'starting' | 'live' | 'ended' }

const ended: Desktop = { state: 'ended' }

const desktopAtom = Atom.family((id: string) =>
  Atom.readable((get): Desktop => {
    const owner = get(chromeAtom)?.threads.find((thread) => thread.desktop?.id === id)
    return owner?.desktop ? { threadId: owner.id, state: owner.desktop.state } : ended
  }).pipe(Atom.withEquality(Equal.equals))
)

export function useDesktop(id: string) {
  return useAtomValue(desktopAtom(id))
}

export function desktopTabId(id: string) {
  return `desktop:${id}`
}

// The desktops a thread's details pane has tabs for, opened from chat chips.
const desktopTabsAtom = Atom.family((_threadId: string) =>
  Atom.make<readonly string[]>([]).pipe(Atom.keepAlive)
)

const runningDesktopAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => get(threadMetaAtom(threadId))?.desktop?.id)
)

export function useDesktopTabs(threadId: string) {
  const registry = useContext(RegistryContext)
  const ids = useAtomValue(desktopTabsAtom(threadId))
  const running = useAtomValue(runningDesktopAtom(threadId))
  const show = useCallback(
    (id: string) => openDesktop(registry, threadId, id),
    [registry, threadId]
  )
  const close = useCallback(
    (id: string) =>
      registry.update(desktopTabsAtom(threadId), (open) => open.filter((entry) => entry !== id)),
    [registry, threadId]
  )
  return useMemo(() => ({ ids, running, show, close }), [ids, running, show, close])
}

function openDesktop(registry: AtomRegistry.AtomRegistry, threadId: string, id: string) {
  registry.update(desktopTabsAtom(threadId), (open) => (open.includes(id) ? open : [...open, id]))
  registry.set(detailsRequestAtom, { threadId, tab: desktopTabId(id) })
}

// Opens a desktop's tab in a thread's details pane.
export function useOpenDesktop() {
  return useAction(openDesktop)
}

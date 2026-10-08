import type { SubagentStatus, ThreadItem } from '@jetty/shared/items'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/reactivity'
import { useCallback, useContext } from 'react'

import { peekThread, threadAtom } from './threads'

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

export type SubagentTab = {
  id: string
  title: string
  model: string | undefined
  agentType: string | undefined
  status: SubagentStatus
  needsInput: boolean
}

export function awaitsInput(item: ThreadItem) {
  if (item.kind === 'approval') return !item.decision && !item.withdrawn
  if (item.kind === 'question') return !item.answers && !item.skipped && !item.dismissed
  return false
}

// Only running subagents get a tab, plus the one being viewed so finishing doesn't yank it away.
function subagentTabs(items: readonly ThreadItem[], viewing: string): SubagentTab[] {
  const waiting = new Set<string>()
  for (const item of items) if (item.agentId && awaitsInput(item)) waiting.add(item.agentId)
  const tabs: SubagentTab[] = []
  for (const item of items)
    if (item.kind === 'subagent' && (item.status === 'running' || item.id === viewing))
      tabs.push({
        id: item.id,
        title: item.title,
        model: item.model,
        agentType: item.agentType,
        status: item.status,
        needsInput: waiting.has(item.id),
      })
  return tabs
}

function sameTab(a: SubagentTab, b: SubagentTab) {
  return (Object.keys(a) as (keyof SubagentTab)[]).every((key) => a[key] === b[key])
}

// Tab-relevant fields only, so streaming deltas don't re-render the tab strip.
const subagentTabsAtom = Atom.family((threadId: string) =>
  Atom.readable((get) =>
    subagentTabs(get(threadAtom(threadId))?.items ?? [], get(threadTabAtom(threadId)))
  ).pipe(
    Atom.withEquality<SubagentTab[]>(
      (a, b) => a.length === b.length && a.every((tab, index) => sameTab(tab, b[index]!))
    )
  )
)

const noTabs = Atom.readable<SubagentTab[]>(() => [])

export function useSubagentTabs(threadId: string | undefined) {
  return useAtomValue(threadId ? subagentTabsAtom(threadId) : noTabs)
}

// How a subagent ended, read when it drops out of a running list (its tab, a hover card's row).
// Only a loaded thread knows; asking never subscribes to one.
export function useSubagentOutcome(threadId: string | undefined) {
  const registry = useContext(RegistryContext)
  return useCallback(
    (id: string): SubagentStatus | undefined => {
      if (!threadId) return undefined
      const item = peekThread(registry, threadId)?.items.find((entry) => entry.id === id)
      return item?.kind === 'subagent' ? item.status : undefined
    },
    [registry, threadId]
  )
}

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
      registry.set(threadTabAtom(threadId), MAIN_TAB)
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

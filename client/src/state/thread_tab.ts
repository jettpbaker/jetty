import type { SubagentStatus, ThreadItem } from '@jetty/shared/items'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

import { threadAtom } from './threads'

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

function awaitsInput(item: ThreadItem) {
  if (item.kind === 'approval') return !item.decision
  if (item.kind === 'question') return !item.answers && !item.skipped
  return false
}

function subagentTabs(items: readonly ThreadItem[]): SubagentTab[] {
  const waiting = new Set<string>()
  for (const item of items) if (item.agentId && awaitsInput(item)) waiting.add(item.agentId)
  const tabs: SubagentTab[] = []
  for (const item of items)
    if (item.kind === 'subagent')
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
  Atom.readable((get) => subagentTabs(get(threadAtom(threadId))?.items ?? [])).pipe(
    Atom.withEquality<SubagentTab[]>(
      (a, b) => a.length === b.length && a.every((tab, index) => sameTab(tab, b[index]!))
    )
  )
)

const noTabs = Atom.readable<SubagentTab[]>(() => [])

export function useSubagentTabs(threadId: string | undefined) {
  return useAtomValue(threadId ? subagentTabsAtom(threadId) : noTabs)
}

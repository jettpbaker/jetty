import type { SubagentStatus, ThreadItem } from '@jetty/shared/items'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { summaryItems } from '@jetty/shared/history'
import { awaitsInput } from '@jetty/shared/items'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useCallback, useContext } from 'react'

import { useAction } from './connection'
import { detailsRequestAtom } from './thread_tab'
import { peekThread, threadAtom } from './threads'

export type SubagentSummary = {
  id: string
  title: string
  status: SubagentStatus
  // It is waiting on an approval or an answer.
  waiting: boolean
  model: string | undefined
  agentType: string | undefined
  taskId: string | undefined
  tokens: number | undefined
  durationMs: number | undefined
  createdAt: number
  completedAt: number | undefined
}

function summarise(items: readonly ThreadItem[]): SubagentSummary[] {
  const waiting = new Set<string>()
  for (const item of items) if (item.agentId && awaitsInput(item)) waiting.add(item.agentId)
  const agents: SubagentSummary[] = []
  for (const item of items)
    if (item.kind === 'subagent')
      agents.push({
        id: item.id,
        title: item.title,
        status: item.status,
        waiting: waiting.has(item.id),
        model: item.model,
        agentType: item.agentType,
        taskId: item.taskId,
        tokens: item.tokens,
        durationMs: item.durationMs,
        createdAt: item.createdAt,
        completedAt: item.completedAt,
      })
  return agents
}

function sameSummary(a: SubagentSummary, b: SubagentSummary) {
  return (Object.keys(a) as (keyof SubagentSummary)[]).every((key) => a[key] === b[key])
}

// Only the fields the chat links and the pane read, so streaming deltas don't re-render them.
const subagentsAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => summarise(summaryItems(get(threadAtom(threadId))))).pipe(
    Atom.withEquality<SubagentSummary[]>(
      (a, b) => a.length === b.length && a.every((agent, index) => sameSummary(agent, b[index]!))
    )
  )
)

const noSubagents = Atom.readable<SubagentSummary[]>(() => [])

export function useSubagents(threadId: string | undefined) {
  return useAtomValue(threadId ? subagentsAtom(threadId) : noSubagents)
}

// A link names a subagent by its item id, the id the agent knows it by, or failing both its title.
export function findSubagent(agents: readonly SubagentSummary[], key: string) {
  const title = key.toLowerCase()
  return (
    agents.find((agent) => agent.id === key || agent.taskId === key) ??
    agents.find((agent) => agent.title.toLowerCase() === title)
  )
}

export function useSubagent(threadId: string | undefined, key: string) {
  return findSubagent(useSubagents(threadId), key)
}

// How a subagent ended, read when it drops out of a running list (a hover card's row). Only a
// loaded thread knows; asking never subscribes to one.
export function useSubagentOutcome(threadId: string | undefined) {
  const registry = useContext(RegistryContext)
  return useCallback(
    (id: string): SubagentStatus | undefined => {
      if (!threadId) return undefined
      const item = summaryItems(peekThread(registry, threadId)).find((entry) => entry.id === id)
      return item?.kind === 'subagent' ? item.status : undefined
    },
    [registry, threadId]
  )
}

// The subagents shown as tabs in a thread's details pane, by item id.
const subagentTabsAtom = Atom.family((_threadId: string) =>
  Atom.make<readonly string[]>([]).pipe(Atom.keepAlive)
)

export function subagentTabId(id: string) {
  return `agent:${id}`
}

export function useSubagentTabs(threadId: string) {
  const registry = useContext(RegistryContext)
  const visible = useAtomValue(subagentTabsAtom(threadId))
  const show = useCallback(
    (id: string) =>
      registry.update(subagentTabsAtom(threadId), (ids) => (ids.includes(id) ? ids : [...ids, id])),
    [registry, threadId]
  )
  const hide = useCallback(
    (id: string) =>
      registry.update(subagentTabsAtom(threadId), (ids) => ids.filter((entry) => entry !== id)),
    [registry, threadId]
  )
  return { visible, show, hide }
}

function openSubagent(registry: AtomRegistry.AtomRegistry, threadId: string, id: string) {
  registry.update(subagentTabsAtom(threadId), (ids) => (ids.includes(id) ? ids : [...ids, id]))
  registry.set(detailsRequestAtom, { threadId, tab: subagentTabId(id) })
}

// The details pane only, opening it when it's closed.
export function useOpenSubagent() {
  return useAction(openSubagent)
}

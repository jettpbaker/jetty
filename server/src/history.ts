import type { HistoryPage, ThreadSnapshot } from '@jetty/shared/history'
import type { ThreadItem } from '@jetty/shared/items'
import type { ThreadState } from '@jetty/shared/reducer'

import { summaryItem } from '@jetty/shared/history'
import { foldTodos } from '@jetty/shared/todos'

import { StoreError } from './store'

const windowTurns = 100
const pageItems = 1000
const indexes = new WeakMap<readonly ThreadItem[], ReturnType<typeof indexHistory>>()

function indexHistory(items: readonly ThreadItem[]) {
  const first = new Map<string, number>()
  const last = new Map<string, number>()
  const ids = new Map<string, number>()
  const turns = []
  for (const [index, item] of items.entries()) {
    ids.set(item.id, index)
    if (!first.has(item.turnId)) first.set(item.turnId, index)
    last.set(item.turnId, index)
    if (item.kind === 'user_message' && !item.agentId && !item.from && !item.wake)
      turns.push({ id: item.turnId, itemId: item.id, title: item.text.slice(0, 160) })
  }
  return { first, last, ids, turns, todos: foldTodos(items) }
}

function historyIndex(items: readonly ThreadItem[]) {
  let index = indexes.get(items)
  if (!index) {
    index = indexHistory(items)
    indexes.set(items, index)
  }
  return index
}

function latestTurn(state: ThreadState) {
  return state.activeTurnId ?? state.items.findLast((item) => !item.agentId)?.turnId ?? null
}

export function projectItem(item: ThreadItem, latestTurnId: string | null): ThreadItem {
  if (item.kind !== 'tool_call' || item.turnId === latestTurnId || !item.output) return item
  const fields: Record<string, string> = {}
  if (item.toolName.startsWith('mcp__jetty__')) {
    try {
      const result = JSON.parse(item.output)
      for (const key of ['title', 'command', 'action', 'decision', 'id', 'threadId'])
        if (typeof result?.[key] === 'string') fields[key] = result[key]
    } catch {}
  }
  const taskId = item.toolName === 'TaskCreate' ? /#(\d+)/.exec(item.output)?.[1] : undefined
  return {
    ...item,
    output: '',
    outputBytes: Buffer.byteLength(item.output),
    ...((taskId || Object.keys(fields).length) && {
      outputMeta: { ...(taskId && { taskId }), ...(Object.keys(fields).length && { fields }) },
    }),
  }
}

function alignedRange(state: ThreadState, start: number, end: number) {
  const { first, last } = historyIndex(state.items)
  for (let index = start; index < end; index++) {
    const turn = state.items[index]!.turnId
    const beginning = first.get(turn)!
    if (beginning < start) {
      start = beginning
      index = start - 1
    }
    end = Math.max(end, last.get(turn)! + 1)
  }
  return { start, end }
}

export function historyPage(
  state: ThreadState,
  params: { before?: string; target?: string; oldest?: boolean; agentId?: string }
): HistoryPage {
  const index = historyIndex(state.items)
  let end = state.items.length
  let start = 0
  if (params.agentId) {
    const at = index.ids.get(params.agentId)
    if (at === undefined) throw new StoreError('not_found', 'Subagent not found')
    start = at
    end = state.items.findLastIndex((item) => item.agentId === params.agentId) + 1
    end = Math.max(end, at + 1)
  } else if (params.target || params.oldest) {
    const at = params.target ? index.ids.get(params.target) : 0
    if (at === undefined) throw new StoreError('not_found', 'History item not found')
    start = index.first.get(state.items[at]?.turnId ?? '') ?? 0
    end = start
    const turns = new Set<string>()
    while (end < state.items.length && end - start < pageItems && turns.size < windowTurns)
      turns.add(state.items[end++]!.turnId)
  } else {
    if (params.before) {
      const at = index.ids.get(params.before)
      if (at === undefined) throw new StoreError('not_found', 'History cursor not found')
      end = at
    }
    start = end
    const turns = new Set<string>()
    while (start > 0 && end - start < pageItems && turns.size < windowTurns)
      turns.add(state.items[--start]!.turnId)
  }
  const range = alignedRange(state, start, end)
  const items = state.items.slice(range.start, range.end)
  const turnIds = new Set(items.map((item) => item.turnId))
  return {
    items: items.map((item) => projectItem(item, latestTurn(state))),
    start: range.start,
    total: state.items.length,
    seq: state.lastSeq,
    turnOutcomes: Object.fromEntries(
      Object.entries(state.turnOutcomes).filter(([id]) => turnIds.has(id))
    ),
    turnLoadouts: Object.fromEntries(
      Object.entries(state.turnLoadouts).filter(([id]) => turnIds.has(id))
    ),
    todoUpdates: Object.fromEntries(
      items
        .filter((item) => index.todos.updates.has(item.id))
        .map((item) => [item.id, index.todos.updates.get(item.id) ?? null])
    ),
  }
}

export function threadSnapshot(state: ThreadState): ThreadSnapshot {
  if (state.items.length <= pageItems)
    return {
      ...state,
      items: state.items.map((item) => projectItem(item, latestTurn(state))),
      history: {
        total: state.items.length,
        ranges: [{ start: 0, end: state.items.length }],
        todoUpdates: {},
      },
    }
  const page = historyPage(state, {})
  const items = page.items
  const latest = latestTurn(state)
  const firstLatest = state.items.findIndex((item) => item.turnId === latest)
  const support = state.items.filter(
    (item) => summaryItem(item) && (item.kind !== 'tool_call' || item.turnId === latest)
  )
  const summaryTurns = new Set(support.map((item) => item.turnId))
  const summaryOutcomes = Object.fromEntries(
    Object.entries(state.turnOutcomes).filter(([id]) => summaryTurns.has(id))
  )
  const summaryLoadouts = Object.fromEntries(
    Object.entries(state.turnLoadouts).filter(([id]) => summaryTurns.has(id))
  )
  return {
    ...state,
    items,
    turnOutcomes: { ...page.turnOutcomes, ...summaryOutcomes },
    turnLoadouts: { ...page.turnLoadouts, ...summaryLoadouts },
    history: {
      total: state.items.length,
      ranges: [{ start: page.start, end: state.items.length }],
      todoUpdates: page.todoUpdates,
    },
    summary: {
      latestTurnId: latest,
      items: support.map((item) => projectItem(item, latest)),
      todoBase: foldTodos(state.items.slice(0, Math.max(0, firstLatest))).tracked,
      turns: historyIndex(state.items).turns,
      messageIds: state.items.filter((item) => item.kind === 'user_message').map((item) => item.id),
    },
  }
}

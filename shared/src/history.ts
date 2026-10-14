import { Schema } from 'effect'

import { TurnLoadout } from './events'
import { ThreadItem, awaitsInput } from './items'
import { ThreadState, TurnOutcome } from './reducer'
import { todoTools } from './todos'

export const HistoryTurn = Schema.Struct({
  id: Schema.String,
  itemId: Schema.String,
  title: Schema.String,
})
export type HistoryTurn = Schema.Schema.Type<typeof HistoryTurn>

export const HistoryRange = Schema.Struct({ start: Schema.Natural, end: Schema.Natural })
export type HistoryRange = Schema.Schema.Type<typeof HistoryRange>

export const TodoState = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  status: Schema.Literals(['done', 'active', 'pending']),
  turnId: Schema.String,
})
export const TodoUpdate = Schema.Struct({
  created: Schema.optional(Schema.Natural),
  moves: Schema.Array(
    Schema.Struct({
      move: Schema.Literals(['finished', 'started', 'reopened', 'renamed', 'added', 'removed']),
      text: Schema.String,
    })
  ),
  done: Schema.Natural,
  total: Schema.Natural,
})

export const ThreadSummary = Schema.Struct({
  items: Schema.Array(ThreadItem),
  todoBase: Schema.Array(TodoState),
  latestTurnId: Schema.NullOr(Schema.String),
  turns: Schema.Array(HistoryTurn),
  messageIds: Schema.Array(Schema.String),
})
export type ThreadSummary = Schema.Schema.Type<typeof ThreadSummary>

export const ThreadHistory = Schema.Struct({
  total: Schema.Natural,
  ranges: Schema.Array(HistoryRange),
  todoUpdates: Schema.Record(Schema.String, Schema.NullOr(TodoUpdate)),
})
export type ThreadHistory = Schema.Schema.Type<typeof ThreadHistory>

export const ThreadSnapshot = Schema.Struct({
  ...ThreadState.fields,
  history: Schema.optional(ThreadHistory),
  summary: Schema.optional(ThreadSummary),
})
export type ThreadSnapshot = Schema.Schema.Type<typeof ThreadSnapshot>

export const HistoryPage = Schema.Struct({
  items: Schema.Array(ThreadItem),
  start: Schema.Natural,
  total: Schema.Natural,
  seq: Schema.Natural,
  turnOutcomes: Schema.Record(Schema.String, TurnOutcome),
  turnLoadouts: Schema.Record(Schema.String, TurnLoadout),
  todoUpdates: Schema.Record(Schema.String, Schema.NullOr(TodoUpdate)),
})
export type HistoryPage = Schema.Schema.Type<typeof HistoryPage>

export function omitToolOutput(item: ThreadItem): ThreadItem {
  if (item.kind !== 'tool_call' || !item.output) return item
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
    outputBytes: new TextEncoder().encode(item.output).byteLength,
    ...((taskId || Object.keys(fields).length) && {
      outputMeta: { ...(taskId && { taskId }), ...(Object.keys(fields).length && { fields }) },
    }),
  }
}

export function summaryItem(item: ThreadItem) {
  return (
    item.kind === 'subagent' ||
    item.kind === 'workflow' ||
    awaitsInput(item) ||
    (item.kind === 'tool_call' && !item.agentId && todoTools.has(item.toolName))
  )
}

export function summaryItems(state: ThreadSnapshot | undefined) {
  return state?.summary?.items ?? state?.items ?? []
}

export function hasMessage(state: ThreadSnapshot | undefined, id: string) {
  return (
    state?.summary?.messageIds.includes(id) || state?.items.some((item) => item.id === id) || false
  )
}

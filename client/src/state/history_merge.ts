import type { SequencedEvent } from '@jetty/shared/events'
import type { HistoryPage, HistoryRange, ThreadSnapshot } from '@jetty/shared/history'
import type { ThreadItem } from '@jetty/shared/items'

import { summaryItem } from '@jetty/shared/history'
import { applyEvent, findThreadItem } from '@jetty/shared/reducer'
import { foldTodos } from '@jetty/shared/todos'

// toolSeq: the last tool call to finish, wherever it sits in history.
export type ThreadView = ThreadSnapshot & { toolSeq?: number; newestStart?: number }

function mergeRanges(ranges: readonly HistoryRange[]) {
  const merged: HistoryRange[] = []
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1)
    if (last && last.end >= range.start)
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) }
    else merged.push(range)
  }
  return merged
}

export function mergeHistory(
  state: ThreadView,
  page: HistoryPage,
  events: readonly SequencedEvent[]
) {
  let fetched = { ...state, items: page.items, lastSeq: page.seq }
  for (const event of events)
    if (event.seq > page.seq && event.event.type !== 'item.started')
      fetched = { ...fetched, ...applyEvent(fetched, event) }
  const byIndex = new Map<number, ThreadItem>()
  for (const [offset, item] of fetched.items.entries()) byIndex.set(page.start + offset, item)
  let offset = 0
  for (const range of state.history?.ranges ?? [{ start: 0, end: state.items.length }])
    for (let index = range.start; index < range.end; index++)
      byIndex.set(index, state.items[offset++]!)
  const items = [...byIndex].sort(([a], [b]) => a - b).map(([, item]) => item)
  return {
    ...state,
    items,
    turnOutcomes: { ...page.turnOutcomes, ...state.turnOutcomes },
    turnLoadouts: { ...page.turnLoadouts, ...state.turnLoadouts },
    history: {
      total: state.history?.total ?? page.total,
      ranges: mergeRanges([
        ...(state.history?.ranges ?? []),
        { start: page.start, end: page.start + page.items.length },
      ]),
      todoUpdates: { ...state.history?.todoUpdates, ...page.todoUpdates },
    },
  }
}

export function foldHistoryEvent(state: ThreadView, update: SequencedEvent): ThreadView {
  if (update.seq <= state.lastSeq) return state
  const next = applyEvent(state, update)
  const { event } = update
  const history = state.history
  let summary = state.summary
  let status = next.status
  if (summary) {
    const turnId =
      event.type === 'turn.started'
        ? event.turnId
        : event.type === 'item.started' && event.item.kind === 'user_message'
          ? event.item.turnId
          : undefined
    if (turnId && turnId !== summary.latestTurnId) {
      summary = {
        ...summary,
        latestTurnId: turnId,
        todoBase: foldTodos(summary.items, summary.latestTurnId ?? undefined, summary.todoBase)
          .tracked,
        items: summary.items.filter((item) => item.kind !== 'tool_call'),
      }
    }
    const reduced =
      event.type === 'item.delta' && !findThreadItem(summary.items, event.itemId)
        ? { ...next, items: summary.items }
        : applyEvent({ ...state, items: summary.items }, update)
    status = reduced.status
    let turns = summary.turns
    if (
      event.type === 'item.started' &&
      event.item.kind === 'user_message' &&
      !event.item.agentId &&
      !event.item.from &&
      !event.item.wake
    )
      turns = [
        ...turns,
        { id: event.item.turnId, itemId: event.item.id, title: event.item.text.slice(0, 160) },
      ]
    if (reduced.items !== summary.items || turns !== summary.turns)
      summary = {
        ...summary,
        items: reduced.items === summary.items ? summary.items : reduced.items.filter(summaryItem),
        turns,
        messageIds:
          event.type === 'item.started' && event.item.kind === 'user_message'
            ? [...summary.messageIds, event.item.id]
            : summary.messageIds,
      }
  }
  return {
    ...state,
    ...next,
    status,
    ...(event.type === 'item.completed' &&
      findThreadItem(next.items, event.itemId)?.kind === 'tool_call' && {
        toolSeq: update.seq,
      }),
    ...(summary && { summary }),
    ...(history &&
      event.type === 'item.started' && {
        history: {
          ...history,
          total: history.total + 1,
          ranges: mergeRanges([
            ...history.ranges,
            { start: history.total, end: history.total + 1 },
          ]),
        },
      }),
  }
}

import { Effect, Schema } from 'effect'

import { ContextUsage, SessionStatus, ThreadEvent, type SequencedEvent } from './events'
import { ThreadItem } from './items'

export const TurnOutcome = Schema.Literals(['completed', 'failed', 'interrupted'])
export type TurnOutcome = Schema.Schema.Type<typeof TurnOutcome>

export const ThreadState = Schema.Struct({
  items: Schema.Array(ThreadItem),
  status: SessionStatus,
  activeTurnId: Schema.NullOr(Schema.String),
  lastSeq: Schema.Natural,
  context: Schema.NullOr(ContextUsage).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  turnOutcomes: Schema.Record(Schema.String, TurnOutcome).pipe(
    Schema.withDecodingDefault(Effect.succeed({}))
  ),
})
export type ThreadState = Schema.Schema.Type<typeof ThreadState>

export const emptyThread: ThreadState = {
  items: [],
  status: 'idle',
  activeTurnId: null,
  lastSeq: 0,
  context: null,
  turnOutcomes: {},
}

export function applyEvent(state: ThreadState, { seq, ts, event }: SequencedEvent): ThreadState {
  if (seq <= state.lastSeq) return state
  return { ...reduce(state, event, ts), lastSeq: seq }
}

function reduce(state: ThreadState, event: ThreadEvent, ts: number): ThreadState {
  switch (event.type) {
    case 'turn.started':
      return { ...state, activeTurnId: event.turnId, status: 'running' }
    case 'turn.completed':
    case 'turn.failed':
      const outcome = turnOutcome(event)
      return {
        ...state,
        turnOutcomes: {
          ...state.turnOutcomes,
          [event.turnId]: outcome,
        },
        activeTurnId: null,
        status: state.items.some(
          (item) =>
            item.kind === 'question' &&
            item.delivery === 'async' &&
            !item.answers &&
            !item.dismissed
        )
          ? 'awaiting_approval'
          : state.items.some((item) => item.kind === 'workflow' && item.status === 'running')
            ? 'running'
            : outcome === 'failed'
              ? 'error'
              : 'idle',
        items: state.items.map((item) => settleStreaming(item, ts)),
      }
    case 'item.started':
      return {
        ...state,
        items: [...state.items, event.item],
        status:
          event.item.kind === 'workflow' && event.item.status === 'running'
            ? 'running'
            : state.status,
      }
    case 'item.delta':
      return updateItem(state, event.itemId, appendDelta(event.delta, event.tokens))
    case 'item.updated':
      return workflowStatus(
        updateItem(state, event.itemId, (item) =>
          Schema.decodeUnknownSync(ThreadItem)({ ...item, ...event.patch })
        )
      )
    case 'item.completed':
      return workflowStatus(
        updateItem(state, event.itemId, (item) =>
          Schema.decodeUnknownSync(ThreadItem)({
            ...settleStreaming(item, ts),
            ...event.patch,
            completedAt: ts,
          })
        )
      )
    case 'session.status':
      return { ...state, status: event.status }
    case 'context.updated':
      return { ...state, context: event.usage }
  }
}

function workflowStatus(state: ThreadState): ThreadState {
  if (state.activeTurnId) return state
  return {
    ...state,
    status: state.items.some(
      (item) =>
        item.kind === 'question' && item.delivery === 'async' && !item.answers && !item.dismissed
    )
      ? 'awaiting_approval'
      : state.items.some((item) => item.kind === 'workflow' && item.status === 'running')
        ? 'running'
        : state.status === 'error'
          ? 'error'
          : 'idle',
  }
}

function turnOutcome(
  event: Extract<ThreadEvent, { type: 'turn.completed' | 'turn.failed' }>
): TurnOutcome {
  if (event.type === 'turn.completed') return 'completed'
  return event.error === 'interrupted' ? 'interrupted' : 'failed'
}

function settleStreaming(item: ThreadItem, ts: number): ThreadItem {
  if ('streaming' in item && item.streaming)
    return { ...item, streaming: false, completedAt: item.completedAt ?? ts }
  return item
}

function appendDelta(delta: string, tokens?: number) {
  return (item: ThreadItem): ThreadItem => {
    switch (item.kind) {
      case 'reasoning':
        return {
          ...item,
          text: item.text + delta,
          ...(tokens != null ? { tokens: (item.tokens ?? 0) + tokens } : {}),
        }
      case 'assistant_message':
      case 'plan':
        return { ...item, text: item.text + delta }
      case 'tool_call':
        return { ...item, output: item.output + delta }
      default:
        return item
    }
  }
}

function updateItem(
  state: ThreadState,
  itemId: string,
  update: (item: ThreadItem) => ThreadItem
): ThreadState {
  const index = state.items.findIndex((item) => item.id === itemId)
  if (index === -1) return state
  const items = [...state.items]
  items[index] = update(items[index]!)
  return { ...state, items }
}

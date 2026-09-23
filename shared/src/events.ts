import { Schema } from 'effect'

import { ThreadItem } from './items'

export const SessionStatus = Schema.Literals([
  'idle',
  'starting',
  'running',
  'awaiting_approval',
  'error',
])
export type SessionStatus = Schema.Schema.Type<typeof SessionStatus>

export const Usage = Schema.Struct({
  inputTokens: Schema.Natural,
  outputTokens: Schema.Natural,
})
export type Usage = Schema.Schema.Type<typeof Usage>

export const ContextSlice = Schema.Struct({
  label: Schema.String,
  tokens: Schema.Natural,
})
export type ContextSlice = Schema.Schema.Type<typeof ContextSlice>

export const ContextUsage = Schema.Struct({
  usedTokens: Schema.Natural,
  maxTokens: Schema.Int.check(Schema.isGreaterThan(0)),
  compactAt: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  slices: Schema.Array(ContextSlice),
  model: Schema.optional(Schema.String),
  asOf: Schema.Int,
})
export type ContextUsage = Schema.Schema.Type<typeof ContextUsage>

export const ThreadEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal('turn.started'), turnId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('turn.completed'),
    turnId: Schema.String,
    usage: Schema.optional(Usage),
    costUsd: Schema.optional(Schema.Finite),
  }),
  Schema.Struct({
    type: Schema.Literal('turn.failed'),
    turnId: Schema.String,
    error: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal('item.started'), item: ThreadItem }),
  Schema.Struct({
    type: Schema.Literal('item.delta'),
    itemId: Schema.String,
    delta: Schema.String,
    // an increment, not a running total
    tokens: Schema.optional(Schema.Natural),
  }),
  Schema.Struct({
    type: Schema.Literal('item.completed'),
    itemId: Schema.String,
    patch: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  Schema.Struct({ type: Schema.Literal('session.status'), status: SessionStatus }),
  Schema.Struct({ type: Schema.Literal('context.updated'), usage: ContextUsage }),
])
export type ThreadEvent = Schema.Schema.Type<typeof ThreadEvent>

export const SequencedEvent = Schema.Struct({
  seq: Schema.Int.check(Schema.isGreaterThan(0)),
  ts: Schema.Int,
  event: ThreadEvent,
})
export type SequencedEvent = Schema.Schema.Type<typeof SequencedEvent>

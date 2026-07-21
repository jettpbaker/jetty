import { z } from 'zod'

import { ThreadItem } from './items'

export const SessionStatus = z.enum(['idle', 'starting', 'running', 'awaiting_approval', 'error'])
export type SessionStatus = z.infer<typeof SessionStatus>

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
})
export type Usage = z.infer<typeof Usage>

export const ThreadEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn.started'), turnId: z.string() }),
  z.object({
    type: z.literal('turn.completed'),
    turnId: z.string(),
    usage: Usage.optional(),
    costUsd: z.number().optional(),
  }),
  z.object({ type: z.literal('turn.failed'), turnId: z.string(), error: z.string() }),
  z.object({ type: z.literal('item.started'), item: ThreadItem }),
  z.object({
    type: z.literal('item.delta'),
    itemId: z.string(),
    delta: z.string(),
    /** estimated thinking tokens in this delta (an increment, not a running total) */
    tokens: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('item.completed'),
    itemId: z.string(),
    patch: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal('session.status'), status: SessionStatus }),
])
export type ThreadEvent = z.infer<typeof ThreadEvent>

export const SequencedEvent = z.object({
  seq: z.number().int().positive(),
  ts: z.number().int(),
  event: ThreadEvent,
})
export type SequencedEvent = z.infer<typeof SequencedEvent>

import { z } from 'zod'

export const Attachment = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
})
export type Attachment = z.infer<typeof Attachment>

export const ApprovalDecision = z.enum(['allow', 'deny'])
export type ApprovalDecision = z.infer<typeof ApprovalDecision>

const itemBase = {
  id: z.string(),
  turnId: z.string(),
  createdAt: z.number().int(),
}

export const ThreadItem = z.discriminatedUnion('kind', [
  z.object({
    ...itemBase,
    kind: z.literal('user_message'),
    text: z.string(),
    attachments: z.array(Attachment),
  }),
  z.object({
    ...itemBase,
    kind: z.literal('assistant_message'),
    text: z.string(),
    streaming: z.boolean().optional(),
  }),
  z.object({
    ...itemBase,
    kind: z.literal('reasoning'),
    text: z.string(),
    streaming: z.boolean().optional(),
  }),
  z.object({
    ...itemBase,
    kind: z.literal('tool_call'),
    toolName: z.string(),
    input: z.unknown(),
    output: z.string(),
    status: z.enum(['running', 'succeeded', 'failed']),
  }),
  z.object({
    ...itemBase,
    kind: z.literal('approval'),
    title: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    suggestions: z.array(z.unknown()),
    decision: ApprovalDecision.optional(),
    deniedReason: z.string().optional(),
  }),
  z.object({
    ...itemBase,
    kind: z.literal('plan'),
    text: z.string(),
    streaming: z.boolean().optional(),
  }),
  z.object({ ...itemBase, kind: z.literal('error'), message: z.string() }),
])
export type ThreadItem = z.infer<typeof ThreadItem>
export type ItemKind = ThreadItem['kind']

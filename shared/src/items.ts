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

export const QuestionSpec = z.object({
  question: z.string(),
  header: z.string(),
  multiSelect: z.boolean(),
  options: z.array(z.object({ label: z.string(), description: z.string() })),
})
export type QuestionSpec = z.infer<typeof QuestionSpec>

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
    /** total estimated thinking tokens so far — the only signal models with omitted thinking text give us */
    tokens: z.number().int().nonnegative().optional(),
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
    kind: z.literal('question'),
    questions: z.array(QuestionSpec),
    /** question text → chosen answer (multi-select comma-separated); set once answered */
    answers: z.record(z.string(), z.string()).optional(),
    /** true when the turn ended (interrupt/close) before an answer */
    skipped: z.boolean().optional(),
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

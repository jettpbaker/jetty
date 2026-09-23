import { Schema } from 'effect'

export const MAX_GALLERY_IMAGES = 4

export const Attachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Natural,
  // Pixel size, so the chat can reserve an image's space before it loads.
  width: Schema.optional(Schema.Int),
  height: Schema.optional(Schema.Int),
})
export type Attachment = Schema.Schema.Type<typeof Attachment>

export const ApprovalDecision = Schema.Literals(['allow', 'deny'])
export type ApprovalDecision = Schema.Schema.Type<typeof ApprovalDecision>

export const QuestionSpec = Schema.Struct({
  question: Schema.String,
  header: Schema.String,
  multiSelect: Schema.Boolean,
  options: Schema.Array(Schema.Struct({ label: Schema.String, description: Schema.String })),
})
export type QuestionSpec = Schema.Schema.Type<typeof QuestionSpec>

export const SubagentStatus = Schema.Literals(['running', 'completed', 'failed', 'stopped'])
export type SubagentStatus = Schema.Schema.Type<typeof SubagentStatus>

const itemBase = {
  id: Schema.String,
  turnId: Schema.String,
  createdAt: Schema.Int,
  completedAt: Schema.optional(Schema.Int),
  // the subagent item this was produced inside; absent on the main timeline
  agentId: Schema.optional(Schema.String),
}

export const ThreadItem = Schema.Union([
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('user_message'),
    from: Schema.optional(Schema.Struct({ threadId: Schema.String, title: Schema.String })),
    hop: Schema.optional(Schema.Natural),
    text: Schema.String,
    attachments: Schema.Array(Attachment),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('assistant_message'),
    text: Schema.String,
    streaming: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('reasoning'),
    text: Schema.String,
    streaming: Schema.optional(Schema.Boolean),
    // a running total of estimated thinking tokens, unlike item.delta's increment
    tokens: Schema.optional(Schema.Natural),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('tool_call'),
    toolName: Schema.String,
    input: Schema.Unknown,
    output: Schema.String,
    status: Schema.Literals(['running', 'succeeded', 'failed']),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('approval'),
    title: Schema.String,
    toolName: Schema.String,
    input: Schema.Unknown,
    suggestions: Schema.Array(Schema.Unknown),
    decision: Schema.optional(ApprovalDecision),
    deniedReason: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('question'),
    questions: Schema.Array(QuestionSpec),
    // multi-select answers are comma-separated
    answers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    // the turn ended unanswered, not a user choice
    skipped: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('image_gallery'),
    images: Schema.Array(Attachment)
      .check(Schema.isMinLength(1))
      .check(Schema.isMaxLength(MAX_GALLERY_IMAGES)),
    caption: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('video'),
    video: Attachment,
    caption: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('plan'),
    text: Schema.String,
    streaming: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('subagent'),
    title: Schema.String,
    prompt: Schema.String,
    agentType: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    status: SubagentStatus,
    tokens: Schema.optional(Schema.Natural),
    durationMs: Schema.optional(Schema.Natural),
  }),
  Schema.Struct({ ...itemBase, kind: Schema.Literal('error'), message: Schema.String }),
])
export type ThreadItem = Schema.Schema.Type<typeof ThreadItem>

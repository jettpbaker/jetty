import { Schema } from 'effect'

/** Images the agent may send in one `send_images` call — a gallery, not a dump. */
export const MAX_GALLERY_IMAGES = 4

export const Attachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Natural,
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

const itemBase = {
  id: Schema.String,
  turnId: Schema.String,
  createdAt: Schema.Int,
}

export const ThreadItem = Schema.Union([
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('user_message'),
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
    /** total estimated thinking tokens so far — the only signal models with omitted thinking text give us */
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
    /** question text → chosen answer (multi-select comma-separated); set once answered */
    answers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    /** true when the turn ended (interrupt/close) before an answer */
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
  Schema.Struct({ ...itemBase, kind: Schema.Literal('error'), message: Schema.String }),
])
export type ThreadItem = Schema.Schema.Type<typeof ThreadItem>
export type ItemKind = ThreadItem['kind']

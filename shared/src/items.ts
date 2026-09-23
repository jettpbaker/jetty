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

export const ApprovalDecision = Schema.Literals(['allow', 'always', 'deny'])
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

export const WorkflowAgent = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  phase: Schema.Int,
  model: Schema.optional(Schema.String),
  state: Schema.Literals(['queued', 'active', 'waiting', 'done', 'error']),
  tokens: Schema.Natural,
  toolCalls: Schema.Natural,
  lastTool: Schema.optional(Schema.String),
  lastSummary: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Natural),
  startedAt: Schema.optional(Schema.Int),
})
export type WorkflowAgent = Schema.Schema.Type<typeof WorkflowAgent>

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
    // what "Allow always" would permit; absent when the provider can't remember a choice
    always: Schema.optional(
      Schema.Struct({
        scope: Schema.Literals(['session', 'project', 'user']),
        patterns: Schema.Array(Schema.String),
      })
    ),
    decision: Schema.optional(ApprovalDecision),
    deniedReason: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('question'),
    questions: Schema.Array(QuestionSpec),
    delivery: Schema.optional(Schema.Literal('async')),
    // multi-select answers are comma-separated
    answers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    // the turn ended unanswered, not a user choice
    skipped: Schema.optional(Schema.Boolean),
    dismissed: Schema.optional(Schema.Boolean),
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
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('workflow'),
    taskId: Schema.String,
    name: Schema.String,
    description: Schema.String,
    provider: Schema.Literals(['claude', 'grok']),
    status: SubagentStatus,
    phases: Schema.Array(Schema.Struct({ index: Schema.Int, title: Schema.String })),
    agents: Schema.Array(WorkflowAgent),
    tokens: Schema.Natural,
    durationMs: Schema.Natural,
    runId: Schema.optional(Schema.String),
    scriptPath: Schema.optional(Schema.String),
    transcriptDir: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.String),
    stopReason: Schema.optional(Schema.Literals(['you', 'crash'])),
  }),
  Schema.Struct({ ...itemBase, kind: Schema.Literal('error'), message: Schema.String }),
])
export type ThreadItem = Schema.Schema.Type<typeof ThreadItem>

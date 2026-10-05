import { Effect, Schema } from 'effect'

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

// A child thread's report as the chat shows it: how its run ended and how long it worked, or
// the question it asked its parent.
export const ChildReport = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  outcome: Schema.Literals(['finished', 'failed', 'interrupted', 'paused', 'asked']),
  seconds: Schema.Number,
  question: Schema.optional(Schema.String),
})
export type ChildReport = Schema.Schema.Type<typeof ChildReport>

// One thing Jetty's PR watcher saw on a thread's pull request: who did it, how many, or which
// checks failed.
export const PullRequestActivity = Schema.Struct({
  type: Schema.Literals([
    'checks_failed',
    'checks_passed',
    'changes_requested',
    'approved',
    'commented',
    'conflict',
    'ready',
    'merged',
    'closed',
  ]),
  actor: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Int),
  detail: Schema.optional(Schema.String),
})
export type PullRequestActivity = Schema.Schema.Type<typeof PullRequestActivity>

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
    kind: Schema.Literal('compaction'),
    // Compactions stored before this had a running state were always finished ones.
    status: Schema.Literals(['running', 'completed', 'failed']).pipe(
      Schema.withDecodingDefault(Effect.succeed('completed' as const))
    ),
  }),
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('user_message'),
    from: Schema.optional(Schema.Struct({ threadId: Schema.String, title: Schema.String })),
    hop: Schema.optional(Schema.Natural),
    reports: Schema.optional(Schema.Array(ChildReport)),
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
    changes: Schema.optional(
      Schema.Array(
        Schema.Struct({
          path: Schema.String,
          diff: Schema.optional(Schema.String),
          before: Schema.optional(Schema.String),
          after: Schema.optional(Schema.String),
        })
      )
    ),
    // what "Allow always" would permit; absent when the provider can't remember a choice
    always: Schema.optional(
      Schema.Struct({
        scope: Schema.Literals(['session', 'project', 'user']),
        patterns: Schema.Array(Schema.String),
      })
    ),
    decision: Schema.optional(ApprovalDecision),
    deniedReason: Schema.optional(Schema.String),
    // the tool_call item it gates, when the provider says which
    toolCallId: Schema.optional(Schema.String),
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
  // A line in the chat for the PR watcher; what woke the agent reaches it as a message from Jetty.
  Schema.Struct({
    ...itemBase,
    kind: Schema.Literal('pull_request'),
    repo: Schema.String,
    number: Schema.Int,
    activity: Schema.Array(PullRequestActivity),
    // The hourly wake cap kept this from waking the agent.
    held: Schema.optional(Schema.Boolean),
  }),
])
export type ThreadItem = Schema.Schema.Type<typeof ThreadItem>

// The crash-loop guard: the RESTART_LIMIT-th start within the window resumes nothing, and each
// turn it cut off carries this note as an error.
export const RESTART_LIMIT = 3
export const RESTART_WINDOW_MS = 10 * 60_000
export const RESTART_LIMIT_NOTE = `Jetty restarted ${RESTART_LIMIT} times in ${RESTART_WINDOW_MS / 60_000} minutes, so it didn't resume automatically.`

// The thread's last turn is one the guard held, and nothing has come after it. The guard's note
// closes that turn; only errors about it, such as an undelivered report, and PR watcher lines
// can follow.
export function heldByRestarts(items: readonly ThreadItem[]) {
  const turnId = items.findLast((item) => item.kind !== 'pull_request')?.turnId
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!
    if (item.kind === 'pull_request') continue
    if (item.kind !== 'error' || item.turnId !== turnId) return false
    if (item.message === RESTART_LIMIT_NOTE) return true
  }
  return false
}

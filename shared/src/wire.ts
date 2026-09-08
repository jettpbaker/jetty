import { Schema, SchemaTransformation } from 'effect'
import { uuidv7 } from 'uuidv7'

import { SequencedEvent, SessionStatus } from './events'
import { ApprovalDecision } from './items'
import { ThreadState } from './reducer'

export const newId = (): string => uuidv7()

export const MAX_IMAGES_PER_TURN = 8
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024

export const PermissionMode = Schema.Literals(['auto', 'full_access', 'plan'])
export type PermissionMode = Schema.Schema.Type<typeof PermissionMode>

/** Claude Code reasoning-effort levels (xhigh/max are model-dependent). */
export const EffortLevel = Schema.Literals(['low', 'medium', 'high', 'xhigh', 'max'])
export type EffortLevel = Schema.Schema.Type<typeof EffortLevel>

export const Project = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  title: Schema.String,
  createdAt: Schema.Int,
})
export type Project = Schema.Schema.Type<typeof Project>

export const ThreadGitStatus = Schema.Struct({
  branch: Schema.String,
  dirty: Schema.Boolean,
  pr: Schema.NullOr(
    Schema.Struct({
      number: Schema.Int.check(Schema.isGreaterThan(0)),
      state: Schema.Literals(['draft', 'open', 'merged', 'closed']),
      url: Schema.String,
    })
  ),
})
export type ThreadGitStatus = Schema.Schema.Type<typeof ThreadGitStatus>

export const ThreadMeta = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  status: SessionStatus,
  archived: Schema.Boolean,
  updatedAt: Schema.Int,
  git: Schema.optional(ThreadGitStatus),
})
export type ThreadMeta = Schema.Schema.Type<typeof ThreadMeta>

export const UploadAttachment = Schema.Struct({
  name: Schema.String,
  mimeType: Schema.Literals(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  dataUrl: Schema.String,
})
export type UploadAttachment = Schema.Schema.Type<typeof UploadAttachment>

/** A user-invocable Claude Code skill or slash command. */
export const Skill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
})
export type Skill = Schema.Schema.Type<typeof Skill>

export const methods = {
  'chrome.subscribe': {
    params: Schema.Record(Schema.String, Schema.Unknown).pipe(
      Schema.decodeTo(
        Schema.Struct({}),
        SchemaTransformation.transform({
          decode: () => ({}),
          encode: () => ({}),
        })
      )
    ),
    result: Schema.Null,
  },
  'project.create': {
    // title is always derived server-side from the directory basename; the path
    // must resolve to an existing directory or the server rejects it
    params: Schema.Struct({ path: Schema.String }),
    result: Schema.Struct({ project: Project }),
  },
  'fs.browse': {
    params: Schema.Struct({ partialPath: Schema.String }),
    result: Schema.Struct({
      parentPath: Schema.String,
      entries: Schema.Array(Schema.Struct({ name: Schema.String, fullPath: Schema.String })),
    }),
  },
  'fs.search': {
    // fuzzy filename search over a project's git-tracked files (for @file mentions)
    params: Schema.Struct({
      projectId: Schema.String,
      query: Schema.String,
      limit: Schema.optional(
        Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThanOrEqualTo(100))
      ),
    }),
    result: Schema.Struct({ files: Schema.Array(Schema.String) }),
  },
  'skills.list': {
    // user-invocable Claude Code skills + .claude/commands for a project
    // (plus personal ~/.claude ones). omit projectId for personal-only.
    params: Schema.Struct({
      projectId: Schema.optional(Schema.String),
    }),
    result: Schema.Struct({ skills: Schema.Array(Skill) }),
  },
  'thread.create': {
    params: Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1)),
      projectId: Schema.String,
    }),
    result: Schema.Struct({ thread: ThreadMeta }),
  },
  'thread.archive': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Null,
  },
  'thread.diff': {
    params: Schema.Struct({ threadId: Schema.String }),
    // unified `git diff HEAD` patch text, pulled on demand. truncatedPaths lists
    // files whose hunks were stripped server-side (lockfiles, pathological sizes).
    result: Schema.Struct({
      diff: Schema.String,
      truncatedPaths: Schema.optional(Schema.Array(Schema.String)),
    }),
  },
  'thread.subscribe': {
    params: Schema.Struct({
      threadId: Schema.String,
      afterSeq: Schema.optional(Schema.Natural),
    }),
    result: Schema.Struct({
      snapshot: Schema.optional(ThreadState),
      seq: Schema.Natural,
    }),
  },
  'thread.unsubscribe': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Null,
  },
  'turn.start': {
    params: Schema.Struct({
      threadId: Schema.String,
      text: Schema.String,
      attachments: Schema.optional(
        Schema.Array(UploadAttachment).check(Schema.isMaxLength(MAX_IMAGES_PER_TURN))
      ),
      model: Schema.optional(Schema.String),
      effort: Schema.optional(EffortLevel),
      permissionMode: Schema.optional(PermissionMode),
    }),
    result: Schema.Struct({ turnId: Schema.String }),
  },
  'turn.interrupt': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Null,
  },
  'approval.respond': {
    params: Schema.Struct({
      threadId: Schema.String,
      itemId: Schema.String,
      decision: ApprovalDecision,
      message: Schema.optional(Schema.String),
      updatedPermissions: Schema.optional(Schema.Array(Schema.Unknown)),
    }),
    result: Schema.Null,
  },
  'question.respond': {
    params: Schema.Struct({
      threadId: Schema.String,
      itemId: Schema.String,
      answers: Schema.Record(Schema.String, Schema.String),
    }),
    result: Schema.Null,
  },
} as const

export type MethodName = keyof typeof methods
export type ParamsOf<M extends MethodName> = Schema.Schema.Type<(typeof methods)[M]['params']>
export type ResultOf<M extends MethodName> = Schema.Schema.Type<(typeof methods)[M]['result']>

const methodNames = Object.keys(methods) as [MethodName, ...MethodName[]]

export const RequestMessage = Schema.Struct({
  id: Schema.String,
  method: Schema.Literals(methodNames),
  params: Schema.Unknown,
})
export type RequestMessage = Schema.Schema.Type<typeof RequestMessage>

export const ErrorCode = Schema.Literals([
  'invalid_request',
  'invalid_params',
  'unknown_method',
  'not_found',
  'internal',
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export const WireError = Schema.Struct({ code: ErrorCode, message: Schema.String })
export type WireError = Schema.Schema.Type<typeof WireError>

export const ResponseMessage = Schema.Struct({
  id: Schema.String,
  ok: Schema.Boolean,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(WireError),
})
export type ResponseMessage = Schema.Schema.Type<typeof ResponseMessage>

/** Claude Code plan rate-limit window (pct used 0–100, resetsAt epoch ms). */
export const UsageWindow = Schema.Struct({
  pct: Schema.Finite,
  resetsAt: Schema.Finite,
})
export type UsageWindow = Schema.Schema.Type<typeof UsageWindow>

/** Extra usage credits (fallback after the 5h window). Amounts are major currency units. */
export const ExtraUsage = Schema.Struct({
  used: Schema.Finite,
  limit: Schema.Finite,
  pct: Schema.Finite,
  currency: Schema.String,
})
export type ExtraUsage = Schema.Schema.Type<typeof ExtraUsage>

/** Account rate-limit usage from Claude Code /usage (not per-turn token counts). */
export const Usage = Schema.Struct({
  fiveHour: UsageWindow,
  sevenDay: UsageWindow,
  extraUsage: Schema.optional(ExtraUsage),
  asOf: Schema.Finite,
})
export type Usage = Schema.Schema.Type<typeof Usage>

export const ChromePushData = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('snapshot'),
    projects: Schema.Array(Project),
    threads: Schema.Array(ThreadMeta),
    usage: Schema.optional(Usage),
  }),
  Schema.Struct({ type: Schema.Literal('project.upserted'), project: Project }),
  Schema.Struct({ type: Schema.Literal('thread.upserted'), thread: ThreadMeta }),
  Schema.Struct({ type: Schema.Literal('thread.removed'), threadId: Schema.String }),
  Schema.Struct({ type: Schema.Literal('usage'), usage: Usage }),
])
export type ChromePushData = Schema.Schema.Type<typeof ChromePushData>

export const PushMessage = Schema.Union([
  Schema.Struct({ sub: Schema.Literal('chrome'), data: ChromePushData }),
  Schema.Struct({
    ...SequencedEvent.fields,
    sub: Schema.Literal('thread'),
    threadId: Schema.String,
  }),
])
export type PushMessage = Schema.Schema.Type<typeof PushMessage>

export const ServerMessage = Schema.Union([PushMessage, ResponseMessage])
export type ServerMessage = Schema.Schema.Type<typeof ServerMessage>

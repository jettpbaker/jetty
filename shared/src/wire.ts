import { Schema, SchemaTransformation } from 'effect'
import { uuidv7 } from 'uuidv7'

import { SessionStatus } from './events'
import { ApprovalDecision } from './items'
import { ThreadState } from './reducer'

export function newId() {
  return uuidv7()
}

export const MAX_IMAGES_PER_TURN = 20
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
// Bounds the turn.start frame at ~65 MB rather than 20 full-size images (~270 MB).
export const MAX_TURN_IMAGE_BYTES = 48 * 1024 * 1024
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024

export const PermissionMode = Schema.Literals(['auto', 'full_access'])
export type PermissionMode = Schema.Schema.Type<typeof PermissionMode>

export const EffortLevel = Schema.Literals(['low', 'medium', 'high', 'xhigh', 'max'])
export type EffortLevel = Schema.Schema.Type<typeof EffortLevel>

// Echo stays off this list: it is the test double, not a choice.
export const ProviderId = Schema.Literals(['claude', 'codex', 'grok'])
export type ProviderId = Schema.Schema.Type<typeof ProviderId>

export const ProviderModel = Schema.Struct({
  provider: ProviderId,
  id: Schema.String,
  name: Schema.String,
  efforts: Schema.Array(EffortLevel),
  defaultEffort: Schema.optional(EffortLevel),
  fast: Schema.Boolean,
  autoMode: Schema.Boolean,
})
export type ProviderModel = Schema.Schema.Type<typeof ProviderModel>

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
  pinned: Schema.Boolean,
  updatedAt: Schema.Int,
  provider: Schema.optional(ProviderId),
  model: Schema.optional(Schema.String),
  effort: Schema.optional(EffortLevel),
  fast: Schema.optional(Schema.Boolean),
  git: Schema.optional(ThreadGitStatus),
})
export type ThreadMeta = Schema.Schema.Type<typeof ThreadMeta>

export const UploadAttachment = Schema.Struct({
  name: Schema.String,
  mimeType: Schema.Literals(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  dataUrl: Schema.String,
})
export type UploadAttachment = Schema.Schema.Type<typeof UploadAttachment>

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
    params: Schema.Struct({ path: Schema.String }),
    result: Schema.Struct({ project: Project }),
  },
  'fs.browse': {
    params: Schema.Struct({ partialPath: Schema.String }),
    result: Schema.Struct({
      parentPath: Schema.String,
      entries: Schema.Array(
        Schema.Struct({ name: Schema.String, fullPath: Schema.String, isGitRepo: Schema.Boolean })
      ),
    }),
  },
  'fs.search': {
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
    params: Schema.Struct({ projectId: Schema.optional(Schema.String) }),
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
  'thread.rename': {
    params: Schema.Struct({ threadId: Schema.String, title: Schema.String }),
    result: Schema.Null,
  },
  'thread.pin': {
    params: Schema.Struct({ threadId: Schema.String, pinned: Schema.Boolean }),
    result: Schema.Null,
  },
  'thread.delete': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Null,
  },
  'thread.diff': {
    params: Schema.Struct({ threadId: Schema.String }),
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
  'turn.start': {
    params: Schema.Struct({
      threadId: Schema.String,
      text: Schema.String,
      attachments: Schema.optional(
        Schema.Array(UploadAttachment).check(Schema.isMaxLength(MAX_IMAGES_PER_TURN))
      ),
      model: Schema.optional(Schema.String),
      effort: Schema.optional(EffortLevel),
      fast: Schema.optional(Schema.Boolean),
      permissionMode: Schema.optional(PermissionMode),
      // Locks the thread on the first turn; omitted turns use the server default.
      provider: Schema.optional(ProviderId),
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

export const ErrorCode = Schema.Literals([
  'invalid_request',
  'invalid_params',
  'unknown_method',
  'not_found',
  'conflict',
  'internal',
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export const WireError = Schema.Struct({ code: ErrorCode, message: Schema.String })
export type WireError = Schema.Schema.Type<typeof WireError>

// pct is 0–100
export const UsageWindow = Schema.Struct({
  pct: Schema.Finite,
  resetsAt: Schema.Finite,
})
export type UsageWindow = Schema.Schema.Type<typeof UsageWindow>

// amounts are in major currency units
export const ExtraUsage = Schema.Struct({
  used: Schema.Finite,
  limit: Schema.Finite,
  pct: Schema.Finite,
  currency: Schema.String,
})
export type ExtraUsage = Schema.Schema.Type<typeof ExtraUsage>

export const RateLimits = Schema.Struct({
  fiveHour: UsageWindow,
  sevenDay: UsageWindow,
  extraUsage: Schema.optional(ExtraUsage),
  asOf: Schema.Finite,
})
export type RateLimits = Schema.Schema.Type<typeof RateLimits>

export const ChromePushData = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('snapshot'),
    projects: Schema.Array(Project),
    threads: Schema.Array(ThreadMeta),
    usage: Schema.optional(RateLimits),
    models: Schema.optional(Schema.Array(ProviderModel)),
  }),
  Schema.Struct({ type: Schema.Literal('project.upserted'), project: Project }),
  Schema.Struct({ type: Schema.Literal('thread.upserted'), thread: ThreadMeta }),
  Schema.Struct({ type: Schema.Literal('thread.removed'), threadId: Schema.String }),
  Schema.Struct({ type: Schema.Literal('usage'), usage: RateLimits }),
  Schema.Struct({ type: Schema.Literal('models'), models: Schema.Array(ProviderModel) }),
])
export type ChromePushData = Schema.Schema.Type<typeof ChromePushData>

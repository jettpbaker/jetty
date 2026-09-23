import { Schema, SchemaTransformation } from 'effect'
import { uuidv7 } from 'uuidv7'

import { SessionStatus } from './events'
import { ApprovalDecision, Attachment } from './items'
import { PullRequestData } from './pull-request'
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

export const ModelRef = Schema.Struct({ provider: ProviderId, id: Schema.String })
export type ModelRef = Schema.Schema.Type<typeof ModelRef>

// Cheapest first.
const AUTOMATIC_UTILITY_MODELS: readonly ModelRef[] = [
  { provider: 'codex', id: 'gpt-6-luna' },
  { provider: 'claude', id: 'haiku' },
  { provider: 'grok', id: 'grok-4.7' },
]

export function resolveUtilityModel(
  choice: ModelRef | null | undefined,
  models: readonly ProviderModel[]
): ProviderModel | undefined {
  const find = (ref: ModelRef) =>
    models.find((model) => model.provider === ref.provider && model.id === ref.id)
  return (choice && find(choice)) || AUTOMATIC_UTILITY_MODELS.map(find).find(Boolean)
}

export const ProjectIcon = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('emoji'),
    emoji: Schema.String.check(Schema.isMinLength(1)),
  }),
  Schema.Struct({ type: Schema.Literal('icon'), name: Schema.String.check(Schema.isMinLength(1)) }),
])
export type ProjectIcon = Schema.Schema.Type<typeof ProjectIcon>

export const Project = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  title: Schema.String,
  createdAt: Schema.Int,
  icon: Schema.optional(ProjectIcon),
  containerReady: Schema.optional(Schema.Boolean),
  containerResult: Schema.optional(Schema.String),
  containerProviders: Schema.optional(
    Schema.Struct({
      codex: Schema.Boolean,
      claude: Schema.Boolean,
      grok: Schema.Boolean,
    })
  ),
  containerServices: Schema.optional(Schema.Int),
})
export type Project = Schema.Schema.Type<typeof Project>

export const ThreadGitStatus = Schema.Struct({
  branch: Schema.String,
  dirty: Schema.Boolean,
})
export type ThreadGitStatus = Schema.Schema.Type<typeof ThreadGitStatus>

export const PullRequestLink = Schema.Struct({
  repo: Schema.String,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: Schema.String,
  state: Schema.optional(Schema.Literals(['draft', 'open', 'merged', 'closed'])),
  title: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.Int),
  linkedAt: Schema.Int,
})
export type PullRequestLink = Schema.Schema.Type<typeof PullRequestLink>

export const PullRequestSnapshot = Schema.Struct({
  repo: Schema.String,
  number: Schema.Int,
  status: Schema.Literals(['loading', 'ready', 'unavailable', 'not_found', 'rate_limited']),
  error: Schema.optional(Schema.String),
  refreshedAt: Schema.optional(Schema.Int),
  data: Schema.optional(PullRequestData),
})
export type PullRequestSnapshot = Schema.Schema.Type<typeof PullRequestSnapshot>

export const PullRequestListTab = Schema.Literals(['for-you', 'created'])
export type PullRequestListTab = Schema.Schema.Type<typeof PullRequestListTab>

export const PullRequestListItem = Schema.Struct({
  repo: Schema.String,
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(['draft', 'open', 'merged', 'closed']),
  checks: Schema.optional(Schema.Literals(['pending', 'success', 'failure'])),
  updatedAt: Schema.Int,
})
export type PullRequestListItem = Schema.Schema.Type<typeof PullRequestListItem>

export const PullRequestList = Schema.Struct({
  tab: PullRequestListTab,
  status: Schema.Literals(['loading', 'ready', 'unavailable', 'rate_limited']),
  error: Schema.optional(Schema.String),
  refreshedAt: Schema.optional(Schema.Int),
  items: Schema.optional(Schema.Array(PullRequestListItem)),
})
export type PullRequestList = Schema.Schema.Type<typeof PullRequestList>

export const MessageSource = Schema.Struct({ threadId: Schema.String, title: Schema.String })
export const QueuedMessage = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  createdAt: Schema.Int,
  editingUntil: Schema.optional(Schema.Int),
  from: Schema.optional(MessageSource),
  hop: Schema.Natural,
  attachments: Schema.optional(Schema.Array(Attachment)),
})
export type QueuedMessage = Schema.Schema.Type<typeof QueuedMessage>

export const ThreadMeta = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  environment: Schema.optional(Schema.Literals(['local', 'container'])),
  title: Schema.String,
  status: SessionStatus,
  queuePaused: Schema.optional(Schema.Boolean),
  archived: Schema.Boolean,
  pinned: Schema.Boolean,
  readyForReview: Schema.optional(Schema.Boolean),
  updatedAt: Schema.Int,
  turnStartedAt: Schema.optional(Schema.Int),
  turnEndedAt: Schema.optional(Schema.Int),
  provider: Schema.optional(ProviderId),
  model: Schema.optional(Schema.String),
  effort: Schema.optional(EffortLevel),
  fast: Schema.optional(Schema.Boolean),
  git: Schema.optional(ThreadGitStatus),
  pullRequests: Schema.optional(Schema.Array(PullRequestLink)),
  parentThreadId: Schema.optional(Schema.String),
  createdBy: Schema.optional(Schema.Literals(['user', 'agent'])),
  pendingMessages: Schema.optional(Schema.Array(QueuedMessage)),
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
  'models.refresh': {
    params: Schema.Struct({ force: Schema.optional(Schema.Boolean) }),
    result: Schema.Null,
  },
  'settings.setUtilityModel': {
    params: Schema.Struct({ model: Schema.NullOr(ModelRef) }),
    result: Schema.Null,
  },
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
  'project.setIcon': {
    params: Schema.Struct({ projectId: Schema.String, icon: Schema.NullOr(ProjectIcon) }),
    result: Schema.Null,
  },
  'containers.status': {
    params: Schema.Struct({}),
    result: Schema.Struct({
      enabled: Schema.Boolean,
      docker: Schema.Boolean,
      availableGiB: Schema.NullOr(Schema.Number),
      maxRunning: Schema.Int,
      cpus: Schema.Number,
      memoryGiB: Schema.Number,
      memoryBudgetGiB: Schema.Number,
      idleMinutes: Schema.Number,
      previewUrlTemplate: Schema.optional(Schema.String),
      running: Schema.Int,
      credentials: Schema.Struct({
        codex: Schema.Boolean,
        claude: Schema.Boolean,
        grok: Schema.Boolean,
      }),
      retained: Schema.Array(
        Schema.Struct({
          threadId: Schema.String,
          state: Schema.String,
          checkoutPath: Schema.String,
          lastError: Schema.NullOr(Schema.String),
        })
      ),
    }),
  },
  'containers.setLimits': {
    params: Schema.Struct({
      maxRunning: Schema.Int.check(Schema.isGreaterThan(0)),
      cpus: Schema.Number.check(Schema.isGreaterThan(0)),
      memoryGiB: Schema.Number.check(Schema.isGreaterThan(0)),
    }),
    result: Schema.Null,
  },
  'containers.stop': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Null,
  },
  'project.containerSetupStatus': {
    params: Schema.Struct({ projectId: Schema.String }),
    result: Schema.Struct({
      imageReady: Schema.Boolean,
      capacityError: Schema.NullOr(Schema.String),
    }),
  },
  'project.containerTest': {
    params: Schema.Struct({ projectId: Schema.String }),
    result: Schema.Struct({
      result: Schema.String,
      providers: Schema.Struct({
        codex: Schema.Boolean,
        claude: Schema.Boolean,
        grok: Schema.Boolean,
      }),
    }),
  },
  'thread.startDev': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Struct({
      services: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          port: Schema.Int,
          url: Schema.optional(Schema.String),
        })
      ),
    }),
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
      environment: Schema.optional(Schema.Literals(['local', 'container'])),
      ref: Schema.optional(Schema.String),
    }),
    result: Schema.Struct({ thread: ThreadMeta }),
  },
  'thread.archive': {
    params: Schema.Struct({ threadId: Schema.String, archived: Schema.Boolean }),
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
  'thread.markSeen': {
    params: Schema.Struct({ threadId: Schema.String }),
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
  'thread.diffFile': {
    params: Schema.Struct({
      threadId: Schema.String,
      path: Schema.String,
      prevPath: Schema.optional(Schema.String),
    }),
    result: Schema.Union([
      Schema.Struct({ before: Schema.NullOr(Schema.String), after: Schema.NullOr(Schema.String) }),
      Schema.Struct({ unavailable: Schema.Literals(['tooLarge', 'binary']) }),
    ]),
  },
  'thread.readFile': {
    params: Schema.Struct({ threadId: Schema.String, path: Schema.String }),
    result: Schema.Union([
      Schema.Struct({ contents: Schema.NullOr(Schema.String) }),
      Schema.Struct({ unavailable: Schema.Literals(['tooLarge', 'binary']) }),
    ]),
  },
  'pullRequest.link': {
    params: Schema.Struct({ threadId: Schema.String, reference: Schema.String }),
    result: Schema.Struct({ thread: ThreadMeta }),
  },
  'github.connection': {
    params: Schema.Struct({}),
    result: Schema.Struct({
      state: Schema.Literals(['connected', 'signed-out', 'missing', 'error']),
    }),
  },
  'pullRequest.unlink': {
    params: Schema.Struct({ threadId: Schema.String, reference: Schema.String }),
    result: Schema.Struct({ thread: ThreadMeta }),
  },
  'pullRequest.get': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
    result: PullRequestSnapshot,
  },
  'pullRequest.refresh': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
    result: PullRequestSnapshot,
  },
  'pullRequest.subscribe': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
    result: PullRequestSnapshot,
  },
  'pullRequestList.refresh': {
    params: Schema.Struct({ tab: PullRequestListTab }),
    result: PullRequestList,
  },
  'pullRequestList.subscribe': {
    params: Schema.Struct({ tab: PullRequestListTab }),
    result: PullRequestList,
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
  'queue.add': {
    params: Schema.Struct({
      threadId: Schema.String,
      messageId: Schema.String.check(Schema.isMinLength(1)),
      text: Schema.String,
      attachments: Schema.optional(
        Schema.Array(UploadAttachment).check(Schema.isMaxLength(MAX_IMAGES_PER_TURN))
      ),
    }),
    result: Schema.Null,
  },
  'queue.remove': {
    params: Schema.Struct({ threadId: Schema.String, messageId: Schema.String }),
    result: Schema.Null,
  },
  'queue.edit': {
    params: Schema.Struct({
      threadId: Schema.String,
      messageId: Schema.String,
      text: Schema.String.check(Schema.isMinLength(1)),
    }),
    result: Schema.Null,
  },
  'queue.hold': {
    params: Schema.Struct({ threadId: Schema.String, messageId: Schema.String }),
    result: Schema.Null,
  },
  'queue.release': {
    params: Schema.Struct({ threadId: Schema.String, messageId: Schema.String }),
    result: Schema.Null,
  },
  'queue.sendNow': {
    params: Schema.Struct({ threadId: Schema.String, messageId: Schema.String }),
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
  'workflow.stop': {
    params: Schema.Struct({ threadId: Schema.String, taskId: Schema.String }),
    result: Schema.Null,
  },
  'approval.respond': {
    params: Schema.Struct({
      threadId: Schema.String,
      itemId: Schema.String,
      decision: ApprovalDecision,
      message: Schema.optional(Schema.String),
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
  'question.dismiss': {
    params: Schema.Struct({ threadId: Schema.String, itemId: Schema.String }),
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
    utilityModel: Schema.optional(ModelRef),
  }),
  Schema.Struct({ type: Schema.Literal('project.upserted'), project: Project }),
  Schema.Struct({ type: Schema.Literal('thread.upserted'), thread: ThreadMeta }),
  Schema.Struct({ type: Schema.Literal('thread.removed'), threadId: Schema.String }),
  Schema.Struct({ type: Schema.Literal('usage'), usage: RateLimits }),
  Schema.Struct({ type: Schema.Literal('models'), models: Schema.Array(ProviderModel) }),
  Schema.Struct({ type: Schema.Literal('utilityModel'), model: Schema.NullOr(ModelRef) }),
])
export type ChromePushData = Schema.Schema.Type<typeof ChromePushData>

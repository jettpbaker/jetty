import { Schema, SchemaTransformation } from 'effect'
import { uuidv7 } from 'uuidv7'

import { EffortLevel, SessionStatus } from './events'
import { ApprovalDecision, Attachment, ChildReport, Reply } from './items'
import {
  GitHubActivity,
  GitHubFile,
  GitHubRateLimitHealth,
  PullRequestData,
  ReviewerCandidate,
} from './pull-request'
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

// Echo stays off this list: it is the test double, not a choice.
export const ProviderId = Schema.Literals(['claude', 'codex', 'grok'])
export type ProviderId = Schema.Schema.Type<typeof ProviderId>

export const ProviderCapabilities = Schema.Record(
  ProviderId,
  Schema.Struct({ compaction: Schema.Boolean })
)
export type ProviderCapabilities = Schema.Schema.Type<typeof ProviderCapabilities>

export const ProviderModel = Schema.Struct({
  provider: ProviderId,
  id: Schema.String,
  // The concrete model an alias ID resolves to (Claude's `opus[1m]` → `claude-opus-5-5[1m]`).
  resolvedId: Schema.optional(Schema.String),
  name: Schema.String,
  efforts: Schema.Array(EffortLevel),
  defaultEffort: Schema.optional(EffortLevel),
  fast: Schema.Boolean,
  autoMode: Schema.Boolean,
  contextWindow: Schema.optional(Schema.Literal('1m')),
})
export type ProviderModel = Schema.Schema.Type<typeof ProviderModel>

export const ModelDiscovery = Schema.Record(
  ProviderId,
  Schema.Literals(['loading', 'ready', 'error'])
)
export type ModelDiscovery = Schema.Schema.Type<typeof ModelDiscovery>

export const ModelRef = Schema.Struct({ provider: ProviderId, id: Schema.String })
export type ModelRef = Schema.Schema.Type<typeof ModelRef>

// Jetty's own model jobs: thread titles, PR guides and the bots' daily tidy pass.
export const JobName = Schema.Literals(['title', 'guide', 'tidy'])
export type JobName = Schema.Schema.Type<typeof JobName>

// The model a job runs on; null keeps the job's default.
export const JobModel = Schema.Struct({
  model: Schema.NullOr(ModelRef),
  effort: Schema.optional(EffortLevel),
  fast: Schema.optional(Schema.Boolean),
})
export type JobModel = Schema.Schema.Type<typeof JobModel>

// Haiku (5.5) first, at its lowest effort; then the cheapest of the others.
const DEFAULT_TITLE_MODELS: readonly ModelRef[] = [
  { provider: 'claude', id: 'haiku' },
  { provider: 'codex', id: 'gpt-6-luna' },
  { provider: 'grok', id: 'grok-4.7' },
]

export function resolveTitleModel(
  choice: ModelRef | null | undefined,
  models: readonly ProviderModel[]
): ProviderModel | undefined {
  const find = (ref: ModelRef) =>
    models.find((model) => model.provider === ref.provider && model.id === ref.id)
  return (choice && find(choice)) || DEFAULT_TITLE_MODELS.map(find).find(Boolean)
}

// Guides and tidy passes run on Claude only (pr-guide.ts and bot-tidy.ts drive the Claude Agent SDK).
export const CLAUDE_JOB_DEFAULTS = {
  guide: { model: { provider: 'claude', id: 'claude-sonnet-5-5' }, effort: 'medium' },
  tidy: { model: { provider: 'claude', id: 'sonnet' }, effort: 'high' },
} as const satisfies Record<'guide' | 'tidy', JobModel>

export function claudeJobModel(
  job: 'guide' | 'tidy',
  choice: JobModel | undefined
): JobModel & { model: ModelRef } {
  return choice?.model?.provider === 'claude'
    ? { ...choice, model: choice.model }
    : CLAUDE_JOB_DEFAULTS[job]
}

export function resolveTitleEffort(model: ProviderModel, effort: EffortLevel | undefined) {
  if (effort && model.efforts.includes(effort)) return effort
  return EffortLevel.literals.find((level) => model.efforts.includes(level))
}

export const agentBehaviours = [
  {
    key: 'guidedReviews',
    label: 'Show a Guide tab on pull requests',
    defaultEnabled: true,
  },
  {
    key: 'prefetchPullRequestGuides',
    label: 'Prepare guides for PRs waiting on your review',
    defaultEnabled: true,
  },
  {
    key: 'archiveCompletedThreads',
    label: 'Agents proactively archive completed threads',
    defaultEnabled: true,
    instruction:
      'Call archive_thread on threads you created once their work is merged or no longer needed. Archive other threads only when the user asks.',
  },
  {
    key: 'watchPullRequests',
    label: 'Agents wake on activity in their pull requests',
    defaultEnabled: false,
    instruction:
      "Jetty watches the pull requests you open or last push to. When one gets a review or comments, its checks fail or it hits a merge conflict, Jetty sends you what happened in a <relayed-message> from Jetty, so you don't need to poll CI or wait for reviews. Don't write @jetty in a comment or review you post with `gh`. You post as the user, and that mention wakes the thread.",
  },
  // What wakes an agent once watchPullRequests is on.
  {
    key: 'watchReviews',
    parent: 'watchPullRequests',
    label: 'Reviews and comments',
    defaultEnabled: true,
  },
  {
    key: 'watchChecks',
    parent: 'watchPullRequests',
    label: 'Failing checks',
    defaultEnabled: true,
  },
  {
    key: 'watchConflicts',
    parent: 'watchPullRequests',
    label: 'Merge conflicts',
    defaultEnabled: true,
  },
  {
    key: 'mergeWhenReady',
    parent: 'watchPullRequests',
    label: 'Merge when ready',
    defaultEnabled: false,
  },
] as const

export const AgentBehaviourKey = Schema.Literals(agentBehaviours.map((behaviour) => behaviour.key))
export type AgentBehaviourKey = Schema.Schema.Type<typeof AgentBehaviourKey>

export const AgentBehaviours = Schema.Record(AgentBehaviourKey, Schema.Boolean)
export type AgentBehaviours = Schema.Schema.Type<typeof AgentBehaviours>

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
  checks: Schema.optional(Schema.Literals(['pending', 'success', 'failure'])),
  failingChecks: Schema.optional(Schema.Int),
  reviewDecision: Schema.optional(
    Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])
  ),
  mergeable: Schema.optional(Schema.Literals(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'])),
  mergeStateStatus: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  reviewRequestCount: Schema.optional(Schema.Int),
})
export type PullRequestLink = Schema.Schema.Type<typeof PullRequestLink>

export const GitHubIssue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  state: Schema.Literals(['open', 'closed']),
  stateReason: Schema.NullOr(Schema.Literals(['completed', 'not_planned', 'reopened'])),
  updatedAt: Schema.String,
  author: Schema.NullOr(Schema.Struct({ login: Schema.String, avatarUrl: Schema.String })),
  labels: Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.String })),
  assignees: Schema.Array(Schema.Struct({ login: Schema.String, avatarUrl: Schema.String })),
})
export type GitHubIssue = Schema.Schema.Type<typeof GitHubIssue>

export const IssueSnapshot = Schema.Struct({
  repo: Schema.String,
  number: Schema.Int,
  status: Schema.Literals(['ready', 'unavailable', 'not_found', 'rate_limited']),
  refreshedAt: Schema.optional(Schema.Int),
  issue: Schema.optional(GitHubIssue),
})
export type IssueSnapshot = Schema.Schema.Type<typeof IssueSnapshot>

export const PullRequestSnapshot = Schema.Struct({
  repo: Schema.String,
  number: Schema.Int,
  status: Schema.Literals(['loading', 'ready', 'unavailable', 'not_found', 'rate_limited']),
  error: Schema.optional(Schema.String),
  refreshedAt: Schema.optional(Schema.Int),
  dataRefreshedAt: Schema.optional(Schema.Int),
  data: Schema.optional(PullRequestData),
  rateLimit: Schema.optional(GitHubRateLimitHealth),
  pendingOperation: Schema.optional(
    Schema.Literals(['title', 'merge', 'reviews', 'body', 'state', 'comment', 'thread', 'viewed'])
  ),
})
export type PullRequestSnapshot = Schema.Schema.Type<typeof PullRequestSnapshot>

export const PullRequestGuideFile = Schema.Struct({
  path: Schema.String,
  // 0-based indexes into this file's hunks, in the order @pierre/diffs' parsePatchFiles yields
  // them for the PR's patch (the same parse the Diff tab uses).
  hunks: Schema.Array(Schema.Int),
})
export const PullRequestGuideChapter = Schema.Struct({
  title: Schema.String,
  why: Schema.String,
  kind: Schema.Literals(['core', 'supporting', 'tests', 'generated']),
  files: Schema.Array(PullRequestGuideFile),
})
export const PullRequestGuide = Schema.Struct({
  summary: Schema.String,
  chapters: Schema.Array(PullRequestGuideChapter),
  // Hunks the model didn't place: the "Not in the guide" group.
  unplaced: Schema.Array(PullRequestGuideFile),
})
export type PullRequestGuide = Schema.Schema.Type<typeof PullRequestGuide>
export const PullRequestGuideState = Schema.Struct({
  // skipped: the PR is under the size threshold, so it gets no guide.
  status: Schema.Literals(['generating', 'ready', 'failed', 'skipped']),
  headSha: Schema.String,
  // The guide shown was made for an older head; a new one is generating.
  outdated: Schema.Boolean,
  guide: Schema.optional(PullRequestGuide),
  error: Schema.optional(Schema.String),
})
export type PullRequestGuideState = Schema.Schema.Type<typeof PullRequestGuideState>
// PRs with fewer changed lines (additions plus deletions) get no guide.
export const GUIDE_MIN_CHANGED_LINES = 30

export const PullRequestListTab = Schema.Literals(['for-you', 'created'])
export type PullRequestListTab = Schema.Schema.Type<typeof PullRequestListTab>

export const PullRequestListItem = Schema.Struct({
  headSha: Schema.optional(Schema.String),
  repo: Schema.String,
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(['draft', 'open', 'merged', 'closed']),
  checks: Schema.optional(Schema.Literals(['pending', 'success', 'failure'])),
  author: Schema.optional(
    Schema.Struct({
      login: Schema.String,
      avatar_url: Schema.String,
      name: Schema.optional(Schema.String),
    })
  ),
  additions: Schema.optional(Schema.Int),
  deletions: Schema.optional(Schema.Int),
  reviewDecision: Schema.optional(
    Schema.NullOr(Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']))
  ),
  mergeable: Schema.optional(Schema.Literals(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'])),
  mergeStateStatus: Schema.optional(Schema.String),
  updatedAt: Schema.Int,
})
export type PullRequestListItem = Schema.Schema.Type<typeof PullRequestListItem>

export const PullRequestList = Schema.Struct({
  tab: PullRequestListTab,
  status: Schema.Literals(['loading', 'ready', 'unavailable', 'rate_limited']),
  error: Schema.optional(Schema.String),
  refreshedAt: Schema.optional(Schema.Int),
  items: Schema.optional(Schema.Array(PullRequestListItem)),
  truncated: Schema.optional(Schema.Boolean),
  rateLimit: Schema.optional(GitHubRateLimitHealth),
})
export type PullRequestList = Schema.Schema.Type<typeof PullRequestList>

export const MessageSource = Schema.Struct({ threadId: Schema.String, title: Schema.String })
export const QueuedMessage = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  createdAt: Schema.Int,
  editingUntil: Schema.optional(Schema.Int),
  from: Schema.optional(MessageSource),
  skill: Schema.optional(Schema.String),
  // Jetty's own messages: a restart continuation, a child's report, the PR watcher's news, or a
  // bot's check-in or tidy-pass review, which its user_message carries on as `wake`.
  kind: Schema.optional(
    Schema.Literals(['continuation', 'report', 'pull_request', 'check_in', 'tidy'])
  ),
  // an answer to the turn's async question, kept while its setup ran: it carries that turn on
  carriesOn: Schema.optional(Schema.Literal(true)),
  reports: Schema.optional(Schema.Array(ChildReport)),
  hop: Schema.Natural,
  attachments: Schema.optional(Schema.Array(Attachment)),
  replyTo: Schema.optional(Reply),
})
export type QueuedMessage = Schema.Schema.Type<typeof QueuedMessage>

export const BackgroundTask = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  startedAt: Schema.Int,
})
export type BackgroundTask = Schema.Schema.Type<typeof BackgroundTask>

// A subagent the thread is running right now, for cards that can't wait on the thread's items.
export const RunningSubagent = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  startedAt: Schema.Int,
})
export type RunningSubagent = Schema.Schema.Type<typeof RunningSubagent>

// Between turns, a thread about to send itself its next queued message is already starting.
export function backgroundStatus(
  status: SessionStatus,
  tasks: readonly BackgroundTask[],
  waiting = false,
  delivering = false
) {
  if (status !== 'idle' && status !== 'error') return status
  return delivering ? 'starting' : tasks.length || waiting ? 'monitoring' : status
}

// The next queued message goes out by itself unless the queue is paused, the thread archived, or
// that message held open for an edit.
export function deliversQueue(
  thread: Pick<ThreadMeta, 'pendingMessages' | 'queuePaused' | 'archived'>
) {
  const next = thread.pendingMessages?.[0]
  return Boolean(next && !next.editingUntil && !thread.queuePaused && !thread.archived)
}

export const ThreadMeta = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  environment: Schema.Literals(['local', 'worktree']),
  workingPath: Schema.optional(Schema.String),
  worktree: Schema.optional(
    Schema.Struct({
      state: Schema.Literals(['pending', 'setting_up', 'ready', 'failed', 'stopped']),
      error: Schema.NullOr(Schema.String),
      branch: Schema.NullOr(Schema.String),
    })
  ),
  title: Schema.String,
  status: SessionStatus,
  backgroundTasks: Schema.optional(Schema.Array(BackgroundTask)),
  runningSubagents: Schema.optional(Schema.Array(RunningSubagent)),
  waitingForChildren: Schema.optional(Schema.Boolean),
  // It asked its parent a question and no message has reached it since.
  awaitingParent: Schema.optional(Schema.Boolean),
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
  // The bot whose work this is: set on every thread below a bot, however deep.
  botId: Schema.optional(Schema.String),
  // A bot's quiet thread, out of the sidebar and the bot's chat until it needs Jett, opens a pull
  // request, or he opens or pins it. Absent from then on: it's an ordinary thread.
  quiet: Schema.optional(Schema.Boolean),
  // Reads the project checkout with edits blocked. Set at creation, never cleared.
  readOnly: Schema.optional(Schema.Boolean),
})
export type ThreadMeta = Schema.Schema.Type<typeof ThreadMeta>

// An id names the bot's home folder, as a thread id names its worktree.
export const BotId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/))

export const BOT_NAME_MAX = 24

export const BotShape = Schema.Literals([
  'circle',
  'squircle',
  'drop',
  'cloud',
  'flower',
  'hex',
  'tri',
  'tablet',
  'gumdrop',
  'burst',
  'star',
  'bean',
  'ghost',
  'heart',
])
export type BotShape = Schema.Schema.Type<typeof BotShape>

export const BotColor = Schema.Literals([
  'accent',
  'coral',
  'orange',
  'butter',
  'mint',
  'teal',
  'blue',
  'lilac',
  'rose',
  'cloud',
  'slate',
])
export type BotColor = Schema.Schema.Type<typeof BotColor>

// What the bot's own turn is doing. Between turns it's idle, whatever its workers are doing.
export const BotActivity = Schema.Literals(['idle', 'typing', 'working', 'tidying'])
export type BotActivity = Schema.Schema.Type<typeof BotActivity>

export const BotTaskStatus = Schema.Literals(['todo', 'in_progress', 'done', 'dropped'])
export type BotTaskStatus = Schema.Schema.Type<typeof BotTaskStatus>

// One entry on a bot's own task list. closedAt is set while it's done or dropped.
export const BotTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: BotTaskStatus,
  note: Schema.optional(Schema.String),
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
  closedAt: Schema.optional(Schema.Int),
})
export type BotTask = Schema.Schema.Type<typeof BotTask>

// An Always allowed rule, worded as the bot's settings list it; source is the approval it was
// saved from, absent for one written by hand.
export const BotAllowRule = Schema.Struct({
  id: Schema.String,
  text: Schema.String.check(Schema.isMinLength(1)),
  createdAt: Schema.Int,
  source: Schema.optional(Schema.String),
})
export type BotAllowRule = Schema.Schema.Type<typeof BotAllowRule>

// A bot's chat is the thread with the bot's id: subscribe, interrupt and answer its questions
// through the thread methods. That thread never appears in chrome's thread list.
export const Bot = Schema.Struct({
  id: BotId,
  name: Schema.String,
  allowRules: Schema.optional(Schema.Array(BotAllowRule)),
  shape: BotShape,
  color: BotColor,
  provider: ProviderId,
  model: Schema.String,
  effort: Schema.optional(EffortLevel),
  fast: Schema.Boolean,
  // null: all projects
  projectId: Schema.NullOr(Schema.String),
  permissionMode: PermissionMode,
  createdAt: Schema.Int,
  activity: BotActivity,
  // An open question or approval in its chat, or a worker of its waiting on an approval.
  needsYou: Schema.Boolean,
  // Its last turn failed and no turn has started since.
  failed: Schema.Boolean,
  // A turn ended with a message Jett hasn't seen. Never true mid-turn.
  unread: Schema.Boolean,
  // Every open task, and the ones closed within CLOSED_TASK_SHOWN_MS: in progress, todo, done,
  // then dropped, each oldest first.
  tasks: Schema.Array(BotTask),
})
export type Bot = Schema.Schema.Type<typeof Bot>

// One message a bot sent another, as the one it went to holds it: in its thread, or still queued.
export const BotConversationMessage = Schema.Struct({
  id: Schema.String,
  // The bot that sent it.
  from: Schema.String,
  text: Schema.String,
  createdAt: Schema.Int,
  attachments: Schema.Array(Attachment),
})
export type BotConversationMessage = Schema.Schema.Type<typeof BotConversationMessage>

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

export const UsageWindow = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  pct: Schema.Finite,
  resetsAt: Schema.optional(Schema.Finite),
  minutes: Schema.optional(Schema.Finite),
})
export type UsageWindow = Schema.Schema.Type<typeof UsageWindow>

export const ProviderUsage = Schema.Struct({
  provider: ProviderId,
  connected: Schema.Boolean,
  plan: Schema.optional(Schema.String),
  account: Schema.optional(Schema.String),
  identity: Schema.optional(Schema.String),
  windows: Schema.Array(UsageWindow),
  asOf: Schema.optional(Schema.Finite),
  // This read failed: windows, if any, are the account's last good read, as of asOf.
  failed: Schema.optional(Schema.Boolean),
})
export type ProviderUsage = Schema.Schema.Type<typeof ProviderUsage>

export const DiffScope = Schema.Literals(['branch', 'uncommitted'])
export type DiffScope = Schema.Schema.Type<typeof DiffScope>

// A file in a thread's checkout; contents null when there's no file there.
// `utf8: false` is a lossy decode (the bytes are not UTF-8). Omitted when they are.
export const ProjectFile = Schema.Union([
  Schema.Struct({
    contents: Schema.NullOr(Schema.String),
    utf8: Schema.optional(Schema.Literal(false)),
  }),
  Schema.Struct({ unavailable: Schema.Literals(['tooLarge', 'binary']) }),
])
export type ProjectFile = Schema.Schema.Type<typeof ProjectFile>

// One entry per name, whether it's a local branch, on origin, or both.
export const Branch = Schema.Struct({
  name: Schema.String,
  local: Schema.Boolean,
  origin: Schema.Boolean,
  // checked out in one of Jetty's worktrees
  worktree: Schema.Boolean,
})
export type Branch = Schema.Schema.Type<typeof Branch>

// What the new-thread page's Set up worktrees button sends, and what a bot's setup_worktrees
// thread starts on. `guide` is project.branches' setupGuide.
export function worktreeSetupPrompt(guide: string) {
  return `Set up Jetty worktrees for this project. Read ${guide} and follow it.`
}

export const methods = {
  'settings.providerUsage': {
    params: Schema.Struct({ provider: ProviderId }),
    result: ProviderUsage,
  },
  'models.refresh': {
    params: Schema.Struct({ force: Schema.optional(Schema.Boolean) }),
    result: Schema.Null,
  },
  'settings.setBranchPrefix': {
    params: Schema.Struct({ prefix: Schema.String }),
    result: Schema.Null,
  },
  'settings.info': {
    params: Schema.Struct({}),
    result: Schema.Struct({
      home: Schema.String,
      userHome: Schema.String,
      databaseBytes: Schema.Number,
      sharedPreferences: Schema.String,
    }),
  },
  'settings.setDefaultEnvironment': {
    params: Schema.Struct({ environment: Schema.Literals(['worktree', 'local']) }),
    result: Schema.Null,
  },
  'project.branches': {
    params: Schema.Struct({
      projectId: Schema.String,
      localOnly: Schema.optional(Schema.Boolean),
    }),
    result: Schema.Union([
      Schema.Struct({
        git: Schema.Literal('ok'),
        defaultRef: Schema.String,
        currentBranch: Schema.String,
        // Newest commit first.
        branches: Schema.Array(Branch),
        // from the project's .jetty/worktree.json
        defaultEnvironment: Schema.optional(Schema.Literals(['local', 'worktree'])),
        setupCommand: Schema.optional(Schema.String),
        // Absolute path of Jetty's worktree setup guide, sent while the project has no
        // .jetty/worktree.json.
        setupGuide: Schema.optional(Schema.String),
      }),
      Schema.Struct({ git: Schema.Literals(['missing', 'not-git']) }),
    ]),
  },
  'thread.worktreeChanges': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Struct({ count: Schema.Natural }),
  },
  'thread.compact': { params: Schema.Struct({ threadId: Schema.String }), result: Schema.Null },
  'thread.retrySetup': { params: Schema.Struct({ threadId: Schema.String }), result: Schema.Null },
  // Resumes a thread the crash-loop guard paused, as a restart would have.
  'thread.continue': { params: Schema.Struct({ threadId: Schema.String }), result: Schema.Null },
  'settings.setJobModel': {
    params: Schema.Struct({ job: JobName, ...JobModel.fields }),
    result: Schema.Null,
  },
  'settings.setAgentBehaviour': {
    params: Schema.Struct({ key: AgentBehaviourKey, enabled: Schema.Boolean }),
    result: Schema.Null,
  },
  'chrome.subscribe': {
    params: Schema.Record(Schema.String, Schema.Unknown).pipe(
      Schema.decodeTo(
        Schema.Struct({}),
        SchemaTransformation.transform({ decode: () => ({}), encode: () => ({}) })
      )
    ),
    result: Schema.Null,
  },
  'github.activity': {
    params: Schema.Struct({ activity: GitHubActivity }),
    result: Schema.Never,
  },
  // Open while a window shows the bot's chat, with whether its composer holds a draft. With the
  // window's attention (github.activity), it tells Jetty when Jett is away from the bot.
  'bot.presence': {
    params: Schema.Struct({ botId: Schema.String, draft: Schema.Boolean }),
    result: Schema.Never,
  },
  'project.create': {
    params: Schema.Struct({ path: Schema.String }),
    result: Schema.Struct({ project: Project }),
  },
  'project.delete': {
    params: Schema.Struct({ projectId: Schema.String }),
    result: Schema.Null,
  },
  'project.setIcon': {
    params: Schema.Struct({ projectId: Schema.String, icon: Schema.NullOr(ProjectIcon) }),
    result: Schema.Null,
  },
  'project.rename': {
    params: Schema.Struct({ projectId: Schema.String, title: Schema.String }),
    result: Schema.Null,
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
      // Searches this thread's working folder (its worktree) instead of the project checkout.
      threadId: Schema.optional(Schema.String),
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
      // An id names the thread's worktree folder and branch too, within the 255-byte name limit.
      id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
      projectId: Schema.String,
      environment: Schema.optional(Schema.Literals(['local', 'worktree'])),
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
  // Pinning a quiet thread surfaces it.
  'thread.pin': {
    params: Schema.Struct({ threadId: Schema.String, pinned: Schema.Boolean }),
    result: Schema.Null,
  },
  // Jett has seen it: clears Ready for review, and surfaces a quiet thread he opened.
  'thread.markSeen': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Null,
  },
  'thread.delete': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Null,
  },
  'thread.diff': {
    params: Schema.Struct({ threadId: Schema.String, scope: DiffScope }),
    result: Schema.Struct({
      diff: Schema.String,
      truncatedPaths: Schema.optional(Schema.Array(Schema.String)),
    }),
  },
  'thread.diffFile': {
    params: Schema.Struct({
      threadId: Schema.String,
      scope: DiffScope,
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
    result: ProjectFile,
  },
  // One folder of the thread's working folder ('' is its top), without what git ignores.
  'thread.readDirectory': {
    params: Schema.Struct({ threadId: Schema.String, path: Schema.String }),
    result: Schema.Struct({
      entries: Schema.Array(Schema.Struct({ name: Schema.String, directory: Schema.Boolean })),
    }),
  },
  // Saves only while the file still holds `base`, the text the edit started from (null: no
  // file yet); otherwise the conflict carries what's on disk now.
  'thread.writeFile': {
    params: Schema.Struct({
      threadId: Schema.String,
      path: Schema.String,
      contents: Schema.String,
      base: Schema.NullOr(Schema.String),
    }),
    result: Schema.Union([
      Schema.Struct({ saved: Schema.Literal(true) }),
      Schema.Struct({ conflict: ProjectFile }),
    ]),
  },
  'pullRequest.link': {
    params: Schema.Struct({ threadId: Schema.String, reference: Schema.String }),
    result: Schema.Struct({
      ref: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
      thread: ThreadMeta,
    }),
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
  'pullRequest.guide': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
    result: PullRequestGuideState,
  },
  'pullRequest.prefetch': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
    result: PullRequestSnapshot,
  },
  // One read covers the chip and its hover card. A miss stays a snapshot, so the chip can keep
  // its idle glyph instead of surfacing an error.
  'issue.prefetch': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
    result: IssueSnapshot,
  },
  'pullRequest.refresh': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
    result: PullRequestSnapshot,
  },
  'pullRequest.diffFile': {
    params: Schema.Struct({
      repo: Schema.String,
      baseSha: Schema.String,
      headSha: Schema.String,
      path: Schema.String,
      prevPath: Schema.optional(Schema.String),
    }),
    result: Schema.Union([
      Schema.Struct({ before: Schema.NullOr(Schema.String), after: Schema.NullOr(Schema.String) }),
      Schema.Struct({ unavailable: Schema.Literals(['tooLarge', 'binary', 'missing']) }),
    ]),
  },
  'pullRequest.reviewerCandidates': {
    params: Schema.Struct({ repo: Schema.String, query: Schema.String }),
    result: Schema.Struct({
      candidates: Schema.Array(ReviewerCandidate),
      truncated: Schema.Boolean,
    }),
  },
  'pullRequest.setReviewRequest': {
    params: Schema.Struct({
      repo: Schema.String,
      number: Schema.Int,
      login: Schema.String,
      kind: Schema.optional(Schema.Literals(['user', 'bot', 'team'])),
      requested: Schema.Boolean,
    }),
    result: PullRequestSnapshot,
  },
  'pullRequest.updateTitle': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int, title: Schema.String }),
    result: PullRequestSnapshot,
  },
  'pullRequest.updateBody': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int, body: Schema.String }),
    result: PullRequestSnapshot,
  },
  'pullRequest.setState': {
    params: Schema.Struct({
      repo: Schema.String,
      number: Schema.Int,
      state: Schema.Literals(['open', 'draft', 'closed']),
    }),
    result: PullRequestSnapshot,
  },
  'pullRequest.comment': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int, body: Schema.String }),
    result: PullRequestSnapshot,
  },
  'pullRequest.reply': {
    params: Schema.Struct({
      repo: Schema.String,
      number: Schema.Int,
      commentId: Schema.Int,
      body: Schema.String,
    }),
    result: PullRequestSnapshot,
  },
  'pullRequest.resolveThread': {
    params: Schema.Struct({
      repo: Schema.String,
      number: Schema.Int,
      threadId: Schema.String,
      resolved: Schema.Boolean,
    }),
    result: PullRequestSnapshot,
  },
  'pullRequest.setViewed': {
    params: Schema.Struct({
      repo: Schema.String,
      number: Schema.Int,
      path: Schema.String,
      viewed: Schema.Boolean,
    }),
    result: PullRequestSnapshot,
  },
  'pullRequest.commitFiles': {
    params: Schema.Struct({ repo: Schema.String, sha: Schema.String }),
    result: Schema.Struct({
      files: Schema.Array(GitHubFile),
      parentSha: Schema.NullOr(Schema.String),
    }),
  },
  'pullRequest.merge': {
    params: Schema.Struct({
      repo: Schema.String,
      number: Schema.Int,
      sha: Schema.String,
      mergeMethod: Schema.optional(Schema.Literals(['squash', 'merge', 'rebase'])),
    }),
    result: PullRequestSnapshot,
  },
  'pullRequest.uploadAttachment': {
    params: Schema.Struct({
      repo: Schema.String,
      name: Schema.String,
      mimeType: Schema.String,
      base64data: Schema.String,
    }),
    result: Schema.Struct({ url: Schema.String }),
  },
  'pullRequest.subscribe': {
    params: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
    result: PullRequestSnapshot,
  },
  'pullRequestList.prefetch': {
    params: Schema.Struct({ tab: PullRequestListTab }),
    result: Schema.Array(PullRequestSnapshot),
  },
  'pullRequestList.refresh': {
    params: Schema.Struct({ tab: PullRequestListTab, maxAge: Schema.optional(Schema.Number) }),
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
      replyTo: Schema.optional(Reply),
    }),
    result: Schema.Null,
  },
  'queue.remove': {
    params: Schema.Struct({ threadId: Schema.String, messageId: Schema.String }),
    result: Schema.Null,
  },
  // Puts a message removed in the last few seconds back where it was.
  'queue.restore': {
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
      // The id the message keeps while it waits in the queue and once it is in the thread.
      messageId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
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
      replyTo: Schema.optional(Reply),
    }),
    result: Schema.Struct({ turnId: Schema.String }),
  },
  'turn.interrupt': {
    params: Schema.Struct({ threadId: Schema.String }),
    result: Schema.Null,
  },
  'background.stop': {
    params: Schema.Struct({ threadId: Schema.String, taskId: Schema.optional(Schema.String) }),
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
  // The id is the client's, so it can open the bot's chat before the server answers. The bot
  // speaks first: creating it starts a turn that counts as Jett's.
  'bot.create': {
    params: Schema.Struct({
      id: BotId,
      name: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(BOT_NAME_MAX)),
      shape: BotShape,
      color: BotColor,
      provider: ProviderId,
      model: Schema.String,
      effort: Schema.optional(EffortLevel),
      fast: Schema.Boolean,
      projectId: Schema.NullOr(Schema.String),
      permissionMode: PermissionMode,
    }),
    result: Schema.Struct({ bot: Bot }),
  },
  'bot.update': {
    params: Schema.Struct({
      botId: BotId,
      name: Schema.optional(
        Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(BOT_NAME_MAX))
      ),
      shape: Schema.optional(BotShape),
      color: Schema.optional(BotColor),
      model: Schema.optional(Schema.String),
      effort: Schema.optional(EffortLevel),
      fast: Schema.optional(Schema.Boolean),
      permissionMode: Schema.optional(PermissionMode),
    }),
    result: Schema.Struct({ bot: Bot }),
  },
  // Starts a turn, or joins the running one, whose text Jett sees from then on.
  'bot.send': {
    params: Schema.Struct({
      botId: Schema.String,
      // The user_message item's id, as with turn.start.
      messageId: Schema.String.check(Schema.isMinLength(1)),
      // Empty only when the message carries images.
      text: Schema.String,
      // The chat item Jett is replying to, and the part of it he quotes.
      replyTo: Schema.optional(Reply),
      // New images, as turn.start takes them.
      attachments: Schema.optional(
        Schema.Array(UploadAttachment).check(Schema.isMaxLength(MAX_IMAGES_PER_TURN))
      ),
      // Images the bot's thread already holds, for Retry.
      attachmentIds: Schema.optional(
        Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_IMAGES_PER_TURN))
      ),
    }),
    result: Schema.Null,
  },
  'bot.setAllowRules': {
    params: Schema.Struct({ botId: Schema.String, rules: Schema.Array(BotAllowRule) }),
    result: Schema.Null,
  },
  'bot.markSeen': {
    params: Schema.Struct({ botId: Schema.String }),
    result: Schema.Null,
  },
  // Everything the two bots sent each other, oldest first. Jett can read any of them.
  'bot.conversation': {
    params: Schema.Struct({ botId: Schema.String, otherBotId: Schema.String }),
    result: Schema.Struct({ messages: Schema.Array(BotConversationMessage) }),
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
  'lagged',
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export const WireError = Schema.Struct({ code: ErrorCode, message: Schema.String })
export type WireError = Schema.Schema.Type<typeof WireError>

export const ChromePushData = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('snapshot'),
    // The server's clock when it sent this, for reading its timestamps (edit holds) in a browser
    // whose own clock is off.
    serverTime: Schema.Int,
    projects: Schema.Array(Project),
    threads: Schema.Array(ThreadMeta),
    models: Schema.optional(Schema.Array(ProviderModel)),
    providerCapabilities: Schema.optional(ProviderCapabilities),
    modelDiscovery: Schema.optional(ModelDiscovery),
    branchPrefix: Schema.optional(Schema.String),
    defaultEnvironment: Schema.optional(Schema.Literals(['worktree', 'local'])),
    jobModels: Schema.optional(Schema.Record(JobName, JobModel)),
    agentBehaviours: Schema.optional(AgentBehaviours),
    // Oldest first.
    bots: Schema.optional(Schema.Array(Bot)),
  }),
  Schema.Struct({ type: Schema.Literal('bot.upserted'), bot: Bot }),
  Schema.Struct({ type: Schema.Literal('project.upserted'), project: Project }),
  Schema.Struct({ type: Schema.Literal('project.removed'), projectId: Schema.String }),
  Schema.Struct({ type: Schema.Literal('thread.upserted'), thread: ThreadMeta }),
  Schema.Struct({ type: Schema.Literal('thread.removed'), threadId: Schema.String }),
  Schema.Struct({ type: Schema.Literal('models'), models: Schema.Array(ProviderModel) }),
  Schema.Struct({ type: Schema.Literal('modelDiscovery'), status: ModelDiscovery }),
  Schema.Struct({ type: Schema.Literal('branchPrefix'), prefix: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('defaultEnvironment'),
    environment: Schema.Literals(['worktree', 'local']),
  }),
  Schema.Struct({ type: Schema.Literal('jobModel'), job: JobName, ...JobModel.fields }),
  Schema.Struct({ type: Schema.Literal('agentBehaviours'), behaviours: AgentBehaviours }),
])
export type ChromePushData = Schema.Schema.Type<typeof ChromePushData>

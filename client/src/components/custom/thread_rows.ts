import type { SessionStatus, TurnLoadout } from '@jetty/shared/events'
import type { TurnOutcome } from '@jetty/shared/reducer'

import { SESSION_GAP } from '@/lib/time'
import { createItemSelection, itemDeltasSince } from '@/state/item_selection'
import { pendingTurnId } from '@/state/turns'
import { exchangeEntry, type ExchangeEntry } from '@jetty/shared/bots'
import {
  awaitsInput,
  RESTART_LIMIT_NOTE,
  type ChildReport,
  type ThreadItem,
} from '@jetty/shared/items'
import { claudeModelLabel } from '@jetty/shared/model-name'

import type { ActivityStatus, ToolKind, ToolWords, WorkActivity } from './work_model'

import { foldTodos, todoTools } from './todo_model'

type UserItem = Extract<ThreadItem, { kind: 'user_message' }>
type AssistantItem = Extract<ThreadItem, { kind: 'assistant_message' }>
type PlanItem = Extract<ThreadItem, { kind: 'plan' }>
type ApprovalItem = Extract<ThreadItem, { kind: 'approval' }>
type QuestionItem = Extract<ThreadItem, { kind: 'question' }>
type GalleryItem = Extract<ThreadItem, { kind: 'image_gallery' }>
type VideoItem = Extract<ThreadItem, { kind: 'video' }>
type WorkItem = Extract<ThreadItem, { kind: 'reasoning' | 'tool_call' }>
type StepItem = WorkItem | AssistantItem | QuestionItem | ApprovalItem | SubagentItem
type MarkerItem = Extract<ThreadItem, { kind: 'thread_marker' }>
type WorkRow = Extract<ThreadRow, { kind: 'work' }>
export type SubagentItem = Extract<ThreadItem, { kind: 'subagent' }>
type WorkflowItem = Extract<ThreadItem, { kind: 'workflow' }>
export type BackgroundItem = Extract<ThreadItem, { kind: 'background' }>
export type PullRequestItem = Extract<ThreadItem, { kind: 'pull_request' }>

export type ThreadRow =
  // steered: it went into a running turn; steering: on its way into one
  | { kind: 'user'; id: string; item: UserItem; steered?: boolean; steering?: boolean }
  | { kind: 'reports'; id: string; reports: readonly ChildReport[] }
  // Bot chats only. What woke the bot: a worker's report, or one of Jetty's own wakes.
  | {
      kind: 'wake'
      id: string
      reports?: readonly ChildReport[]
      wake?: 'check_in' | 'tidy'
    }
  // Bot chats only. Messages with other bots, gathered into one line.
  | { kind: 'exchange'; id: string; entries: ExchangeEntry[] }
  // Bot chats only. A tidy of the bot's notes holds Jett's message, and the chat hides it.
  | { kind: 'tidying'; id: string }
  // Bot chats only. Threads the bot started or messaged.
  | { kind: 'markers'; id: string; markers: MarkerItem[] }
  | { kind: 'subagentDone'; id: string; agent: SubagentItem }
  | {
      kind: 'assistant'
      id: string
      item: AssistantItem
      streaming: boolean
      loadout?: TurnLoadout
      // What the footer copies; only the last message of a run carries one.
      footer?: string
    }
  | {
      kind: 'plan'
      id: string
      item: PlanItem
      streaming: boolean
      loadout?: TurnLoadout
      footer?: string
    }
  | {
      kind: 'work'
      id: string
      turnId: string
      activities: WorkActivity[]
      status: ActivityStatus
      startedAt?: number
      elapsedSeconds?: number
      settingUp?: boolean
      // a Jetty restart cut the turn off
      restarted?: boolean
    }
  | { kind: 'compaction'; id: string; running: boolean }
  | { kind: 'pullRequest'; id: string; item: PullRequestItem }
  | { kind: 'pullRequestGroup'; id: string; items: PullRequestItem[] }
  | { kind: 'restart'; id: string }
  | { kind: 'backgroundStopped'; id: string }
  | { kind: 'background'; id: string; item: BackgroundItem }
  // the crash-loop guard held the turn; resumed once anything follows it
  | { kind: 'restartLimit'; id: string; resumed: boolean }
  | { kind: 'error'; id: string; message: string; turnId: string }
  | { kind: 'gallery'; id: string; item: GalleryItem }
  | { kind: 'video'; id: string; item: VideoItem }
  | { kind: 'workflow'; id: string; item: WorkflowItem }

function toolKind(name: string): ToolKind {
  switch (name.toLowerCase()) {
    case 'read':
    case 'read_file':
      return 'read'
    case 'edit':
    case 'multiedit':
    case 'strreplace':
      return 'edit'
    case 'write':
      return 'write'
    case 'grep':
    case 'glob':
    case 'search':
      return 'search'
    case 'bash':
    case 'shell':
      return 'terminal'
    case 'websearch':
    case 'webfetch':
      return 'web'
    default:
      return 'generic'
  }
}

const pathKeys = new Set(['file_path', 'path'])

function mcpTool(name: string) {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match ? { server: match[1]!, tool: match[2]! } : undefined
}

// Jetty's MCP tools answer with JSON text.
function resultField(output: string, key: string) {
  try {
    const value = (JSON.parse(output) as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

type JettyTool = {
  action: string
  words: ToolWords
  target: (input: Record<string, unknown>, output: string) => string | undefined
  detail?: (input: Record<string, unknown>) => string | undefined
}

function words(active: string, done: string, singular: string, noun = `${singular}s`) {
  return { active, done, singular, noun }
}

const jettyTools: Record<string, JettyTool> = {
  add_project: {
    action: 'Add project',
    words: words('Adding', 'Added', 'project'),
    target: (input) =>
      typeof input.path === 'string'
        ? input.path.replace(/\/+$/, '').split('/').at(-1) || input.path
        : undefined,
    detail: (input) => (typeof input.path === 'string' ? input.path : undefined),
  },
  add_task: {
    action: 'Add task',
    words: words('Adding', 'Added', 'task'),
    target: (input) => (typeof input.title === 'string' ? input.title : undefined),
  },
  update_task: {
    action: 'Update task',
    words: words('Updating', 'Updated', 'task'),
    target: (input, output) =>
      typeof input.title === 'string' ? input.title : resultField(output, 'title'),
  },
  list_tasks: {
    action: 'List tasks',
    words: words('Listing', 'Listed', 'task list'),
    target: () => 'tasks',
  },
  message_user: {
    action: 'Send message',
    words: words('Sending', 'Sent', 'message'),
    target: (input) => (typeof input.text === 'string' ? input.text : undefined),
  },
  list_threads: {
    action: 'List threads',
    words: words('Listing', 'Listed', 'thread list'),
    target: () => 'threads',
  },
  list_bots: {
    action: 'List bots',
    words: words('Listing', 'Listed', 'bot'),
    target: () => 'bots',
  },
  search_threads: {
    action: 'Search threads',
    words: words('Searching', 'Found', 'thread'),
    target: () => 'threads',
  },
  read_thread: {
    action: 'Read thread',
    words: words('Reading', 'Read', 'thread'),
    target: (_, output) => resultField(output, 'title'),
  },
  create_thread: {
    action: 'Create thread',
    words: words('Creating', 'Created', 'thread'),
    target: (input) => (typeof input.title === 'string' ? input.title : undefined),
  },
  list_models: {
    action: 'List models',
    words: words('Listing', 'Listed', 'model list'),
    target: () => 'models',
  },
  stop_thread: {
    action: 'Stop thread',
    words: words('Stopping', 'Stopped', 'thread'),
    target: () => 'thread',
  },
  archive_thread: {
    action: 'Archive thread',
    words: words('Archiving', 'Archived', 'thread'),
    target: (_, output) => resultField(output, 'title'),
  },
  send_message: {
    action: 'Send message',
    words: words('Messaging', 'Messaged', 'thread'),
    target: (_, output) => resultField(output, 'title'),
  },
  link_pull_request: {
    action: 'Link pull request',
    words: words('Linking', 'Linked', 'pull request'),
    target: (input) => (typeof input.pullRequest === 'string' ? input.pullRequest : undefined),
  },
  send_images: {
    action: 'Share images',
    words: words('Sharing', 'Shared', 'gallery', 'galleries'),
    target: (input) => {
      const count = [input.paths, input.attachmentIds].flat().filter(Boolean).length
      return count ? `${count} image${count === 1 ? '' : 's'}` : 'images'
    },
  },
  send_video: {
    action: 'Share video',
    words: words('Sharing', 'Shared', 'video'),
    target: () => 'video',
  },
}

function jettyTool(name: string) {
  const mcp = mcpTool(name)
  return mcp?.server === 'jetty' ? jettyTools[mcp.tool] : undefined
}

// A human name for MCP tools, whose raw ids read as mcp__server__tool.
export function toolAction(name: string) {
  const mcp = mcpTool(name)
  if (!mcp) return name
  return jettyTool(name)?.action ?? `${mcp.server} · ${mcp.tool}`
}

export function toolTarget(name: string, input: unknown, projectPath: string | undefined) {
  if (!input || typeof input !== 'object') return name
  const record = input as Record<string, unknown>
  const jetty = jettyTool(name)
  if (jetty) return jetty.target(record, '') ?? jetty.words.singular
  for (const key of ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'text']) {
    const value = record[key]
    if (typeof value !== 'string' || !value) continue
    return pathKeys.has(key) ? projectRelative(value, projectPath) : value
  }
  return name
}

export function toolDetail(name: string, input: unknown) {
  if (!input || typeof input !== 'object') return undefined
  return jettyTool(name)?.detail?.(input as Record<string, unknown>)
}

export function projectRelative(path: string, projectPath: string | undefined) {
  if (!projectPath) return path
  const root = projectPath.endsWith('/') ? projectPath : `${projectPath}/`
  return path.startsWith(root) ? path.slice(root.length) : path
}

function toolFiles(input: Record<string, unknown>, projectPath: string | undefined) {
  const files = new Set<string>()
  const changes = Array.isArray(input.changes) ? input.changes : []
  for (const source of [input, ...changes]) {
    if (!source || typeof source !== 'object') continue
    for (const key of pathKeys) {
      const path = (source as Record<string, unknown>)[key]
      if (typeof path === 'string' && path)
        files.add(projectRelative(path, projectPath).replace(/^(?:\.\/)+/, ''))
    }
  }
  return [...files]
}

function toolDescription(input: unknown) {
  if (!input || typeof input !== 'object') return undefined
  const { description } = input as Record<string, unknown>
  return typeof description === 'string' ? description : undefined
}

function textRunning(
  item: { streaming?: boolean },
  isThreadTail: boolean,
  sessionRunning: boolean
) {
  return item.streaming ?? (isThreadTail && sessionRunning)
}

function elapsedSeconds(
  span: readonly StepItem[],
  next: ThreadItem | undefined,
  start = span[0]!.createdAt
) {
  const ends = span.map((item) => item.completedAt)
  if (ends.every((end): end is number => end !== undefined))
    return (Math.max(...ends) - start) / 1000
  return next?.turnId === span[0]!.turnId ? (next.createdAt - start) / 1000 : undefined
}

function toActivity(
  item: StepItem,
  next: ThreadItem | undefined,
  sessionRunning: boolean,
  sessionActive: boolean,
  projectPath: string | undefined,
  source?: string,
  waitingAgents?: ReadonlySet<string>
): WorkActivity {
  if (item.kind === 'subagent')
    return {
      type: 'subagent',
      id: item.id,
      title: item.title,
      status: item.status,
      waiting: waitingAgents?.has(item.id) ?? false,
    }
  if (item.kind === 'approval') return { type: 'approval', id: item.id, item, source }
  if (item.kind === 'question') return { type: 'question', id: item.id, item, source }
  if (item.kind === 'assistant_message')
    return {
      type: 'text',
      id: item.id,
      text: item.text,
      streaming: textRunning(item, !next, sessionRunning),
    }
  if (item.kind === 'reasoning') {
    const running = textRunning(item, !next, sessionRunning)
    return {
      type: 'thinking',
      id: item.id,
      status: !running ? 'complete' : sessionActive ? 'running' : 'interrupted',
      summary: item.text,
      tokens: item.tokens,
      elapsedSeconds: running ? undefined : elapsedSeconds([item], next),
    }
  }
  const input = typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2)
  const name = toolAction(item.toolName)
  const jetty = jettyTool(item.toolName)
  const fields = (item.input && typeof item.input === 'object' ? item.input : {}) as Record<
    string,
    unknown
  >
  const kind = toolKind(item.toolName)
  return {
    type: 'tool',
    id: item.id,
    kind,
    name,
    jettyTool:
      mcpTool(item.toolName)?.server === 'jetty' ? mcpTool(item.toolName)?.tool : undefined,
    words: jetty?.words,
    target: jetty
      ? (jetty.target(fields, item.output) ?? jetty.words.singular)
      : mcpTool(item.toolName)
        ? name
        : toolTarget(item.toolName, item.input, projectPath),
    description: toolDescription(item.input),
    files: ['read', 'edit', 'write'].includes(kind) ? toolFiles(fields, projectPath) : undefined,
    fileChange: item.fileChange,
    // A tool Stop cut off is completed with its status left unsettled; a later turn keeps the
    // session active, but that tool stays stopped.
    status:
      item.status === 'failed'
        ? 'failed'
        : item.status === 'succeeded'
          ? 'complete'
          : sessionActive && item.completedAt === undefined
            ? 'running'
            : 'interrupted',
    input,
    output: item.output,
  }
}

// A live turn's block keeps working through the gaps between its activities.
function workStatus(
  activities: readonly WorkActivity[],
  outcome: TurnOutcome | undefined,
  live: boolean
): ActivityStatus {
  // A restart ends the block like a failed turn; its heading says it was interrupted.
  if (outcome === 'server_restarted') return 'failed'
  if (outcome) return outcome === 'completed' ? 'complete' : outcome
  if (live) return 'running'
  // Only the live block is where the agent works now; an earlier one's lingering step (a
  // background command, say) keeps its own running state without the block ticking.
  for (const status of ['waiting', 'interrupted'] as const)
    if (activities.some((activity) => 'status' in activity && activity.status === status))
      return status
  return 'complete'
}

// Before the subagent's first reply its model is unknown; its type stands in.
export function subagentLabel({ model }: { model?: string }) {
  return model ? claudeModelLabel(model) : ''
}

const selectSubagents = createItemSelection((item) => item.kind === 'subagent')

export function threadSubagents(items: readonly ThreadItem[]) {
  return selectSubagents(items) as readonly SubagentItem[]
}

type ThreadRowsOptions = {
  status: SessionStatus
  running: boolean
  outcomes?: Readonly<Record<string, TurnOutcome>>
  loadouts?: Readonly<Record<string, TurnLoadout>>
  projectPath?: string
  threadId?: string
  agentId?: string
  settingUp?: boolean
  bot?: BotRows
}

// A bot's chat is its thread with a few rows of its own. A turn another bot started folds into an
// exchange line, and a check-in or tidy shows only with `showQuiet` or when the bot messaged.
export type BotRows = {
  others: ReadonlySet<string>
  showQuiet: boolean
  // The bot is tidying its notes behind a message of Jett's and the chat doesn't show the tidy:
  // a line stands in for its seam.
  tidying: boolean
}

type BotTurn = {
  // Who opened the turn: Jett's own message, another bot, or anyone else (a worker's report, a
  // wake). Only Jett's turns write public text; elsewhere it's private unless sent as a message.
  opener: 'jett' | 'bot' | 'other'
  quiet: boolean
  joined: boolean
  messaged: boolean
}

const messageUserTool = 'mcp__jetty__message_user'

function botTurns(items: readonly ThreadItem[], { others }: BotRows) {
  const turns = new Map<string, BotTurn & { opened: boolean }>()
  for (const item of items) {
    if (item.agentId) continue
    let turn = turns.get(item.turnId)
    if (!turn) {
      turn = {
        opener: 'other',
        quiet: item.kind === 'compaction',
        joined: false,
        messaged: false,
        opened: false,
      }
      turns.set(item.turnId, turn)
    }
    if (item.kind === 'user_message') {
      if (!turn.opened) {
        turn.opened = true
        turn.opener =
          !item.from && !item.wake
            ? 'jett'
            : item.from && others.has(item.from.threadId)
              ? 'bot'
              : 'other'
        turn.quiet = item.wake !== undefined
      }
      if (!item.from && !item.wake) turn.joined = true
    }
    if (item.kind === 'assistant_message' && !item.private) turn.messaged = true
  }
  return turns
}

type LastTurn = { start: number; row: number }

// Where the last turn starts in the items and the rows, when its rows can be built on their own:
// it opens with a message of the user's (in a bot's chat, or a wake), which closes the answer and
// every exchange line before it, and nothing reaches into it from earlier turns (subagents and
// their finish lines, the task list).
function lastTurn(
  items: readonly ThreadItem[],
  rows: readonly ThreadRow[],
  agentId: string | undefined
): LastTurn | undefined {
  const turnId = items.at(-1)?.turnId
  if (agentId || turnId === undefined) return undefined
  let start = -1
  for (const [index, item] of items.entries()) {
    if (item.agentId || item.kind === 'subagent') return undefined
    if (start === -1 && item.turnId === turnId) start = index
    else if (
      start !== -1 &&
      (item.turnId !== turnId || (item.kind === 'tool_call' && todoTools.has(item.toolName)))
    )
      return undefined
  }
  const first = items[start]!
  if (first.kind !== 'user_message') return undefined
  const row = rows.findLastIndex(
    (row) => (row.kind === 'user' || row.kind === 'wake') && row.id === first.id
  )
  return row === -1 ? undefined : { start, row }
}

function sameOptions(a: ThreadRowsOptions, b: ThreadRowsOptions) {
  const keys = Object.keys(a) as (keyof ThreadRowsOptions)[]
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

// A thread's rows as it changes. A delta into the last turn builds only that turn's rows again,
// after the earlier ones as they were; anything else builds them all.
function handback(item: ThreadItem) {
  return item.kind === 'tool_call' && item.toolName === 'SubagentHandback'
}

function handbackMessage(item: ThreadItem | undefined) {
  if (item?.kind !== 'tool_call' || !item.input || typeof item.input !== 'object') return undefined
  return 'message' in item.input && typeof item.input.message === 'string'
    ? item.input.message
    : undefined
}

export function createThreadRows() {
  let last:
    | {
        items: readonly ThreadItem[]
        options: ThreadRowsOptions
        rows: ThreadRow[]
        turn?: LastTurn
      }
    | undefined
  return function build(items: readonly ThreadItem[], options: ThreadRowsOptions) {
    const turn = last?.turn
    let incremental: ThreadRow[] | undefined
    if (last && turn && sameOptions(last.options, options)) {
      const changed = itemDeltasSince(last.items, items)
      const tail = items.slice(turn.start)
      if (changed?.size && [...changed].every((id) => tail.some((item) => item.id === id)))
        incremental = [...last.rows.slice(0, turn.row), ...threadRows(tail, options)]
    }
    let rows = incremental ?? threadRows(items, options)
    if (incremental && import.meta.env.DEV) {
      const full = threadRows(items, options)
      if (!same(incremental, full)) {
        console.warn('The last turn built alone differs from a full build', { incremental, full })
        rows = full
      }
    }
    last = {
      items,
      options,
      rows,
      turn: rows === incremental ? turn : lastTurn(items, rows, options.agentId),
    }
    return rows
  }
}

export function threadRows(
  allItems: readonly ThreadItem[],
  {
    status,
    running,
    outcomes = {},
    loadouts = {},
    projectPath,
    threadId,
    agentId,
    settingUp = false,
    bot,
  }: ThreadRowsOptions
): ThreadRow[] {
  // A subagent's requests for input also surface on the main timeline, attributed to it.
  const items = allItems.filter(
    (item) =>
      (item.agentId === agentId ||
        (!agentId && (item.kind === 'approval' || item.kind === 'question'))) &&
      !handback(item)
  )
  // The report a subagent handed back closes its transcript as its reply. One stored before Jetty
  // kept it as the result is still only on its SubagentHandback call.
  const report = agentId
    ? allItems.find((item) => item.kind === 'subagent' && item.id === agentId)
    : undefined
  const result =
    report?.kind === 'subagent'
      ? (report.result ??
        handbackMessage(allItems.findLast((item) => item.agentId === agentId && handback(item))))
      : undefined
  if (report?.kind === 'subagent' && result) {
    const last = items.at(-1)
    items.push({
      kind: 'assistant_message',
      id: `${agentId}:result`,
      turnId: last?.turnId ?? report.turnId,
      createdAt: report.completedAt ?? last?.createdAt ?? report.createdAt,
      completedAt: report.completedAt,
      text: result,
      agentId,
    })
  }
  const agentTitles = new Map(
    agentId ? [] : threadSubagents(allItems).map((agent) => [agent.id, agent.title])
  )
  const waitingAgents = new Set(
    allItems.flatMap((item) => (item.agentId && awaitsInput(item) ? [item.agentId] : []))
  )
  const rows: ThreadRow[] = []
  const turns = bot && botTurns(items, bot)
  // A turn that shows nothing of its own: another bot's, or a check-in or tidy Jett didn't join
  // and the bot didn't message about. Its errors, thread markers and message_user messages stay.
  function silent(item: ThreadItem) {
    const turn = turns?.get(item.turnId)
    if (!turn || turn.joined) return false
    return turn.opener === 'bot' || (turn.quiet && !bot!.showQuiet && !turn.messaged)
  }
  function dropped(item: ThreadItem) {
    if (!silent(item)) return false
    if (item.kind === 'error' || item.kind === 'thread_marker') return false
    if (item.kind === 'assistant_message') return item.private === true
    return true
  }
  // Outside Jett's turns the bot's text is private except what it sends as a message, which
  // stands as a reply of its own.
  function sentMessage(item: ThreadItem) {
    return (
      turns !== undefined &&
      item.kind === 'assistant_message' &&
      !item.private &&
      turns.get(item.turnId)?.opener !== 'jett'
    )
  }
  const tail = items.at(-1)
  const sessionRunning = status === 'running' || status === 'starting'
  const sessionActive = sessionRunning || status === 'awaiting_approval'
  const askedTurns = new Set(
    items.filter((item) => item.kind === 'question').map((item) => item.turnId)
  )
  const deniedTools = new Set(
    allItems.flatMap((item) =>
      item.kind === 'approval' && item.decision === 'deny' && item.toolCallId
        ? [item.toolCallId]
        : []
    )
  )
  function isAnsweredQuestionTool(item: ThreadItem) {
    return (
      item.kind === 'tool_call' &&
      item.toolName === 'AskUserQuestion' &&
      askedTurns.has(item.turnId)
    )
  }
  // Questions and declined approvals have their own history entries; Claude
  // loading a deferred tool's schema (ToolSearch) is plumbing, not work. Jetty's note to the agent
  // after a restart is for the agent: the restart's seam tells the user.
  function hidden(item: ThreadItem) {
    return (
      isAnsweredQuestionTool(item) ||
      (item.kind === 'tool_call' && item.status !== 'succeeded' && deniedTools.has(item.id)) ||
      (item.kind === 'tool_call' &&
        ['ToolSearch', 'mcp__jetty__add_instruction'].includes(item.toolName)) ||
      (turns !== undefined &&
        item.kind === 'tool_call' &&
        item.toolName === messageUserTool &&
        turns.get(item.turnId)?.opener !== 'jett') ||
      (item.kind === 'user_message' &&
        item.from?.threadId === threadId &&
        !item.reports &&
        !(bot && item.wake))
    )
  }
  // Outside Jett's turns a bot's private text stays with the work.
  function foldsIntoWork(item: AssistantItem) {
    if (sentMessage(item)) return false
    if (turns && turns.get(item.turnId)?.opener !== 'jett') return true
    return item.turnId === liveTurnId || lastReplies.get(item.turnId) !== item.id
  }
  function isStep(item: ThreadItem): item is WorkItem | QuestionItem | ApprovalItem | SubagentItem {
    return (
      ((item.kind === 'reasoning' || item.kind === 'tool_call') && !hidden(item)) ||
      item.kind === 'subagent' ||
      (item.kind === 'question' && !awaitsInput(item)) ||
      (item.kind === 'approval' &&
        !awaitsInput(item) &&
        (item.decision === 'deny' || !!item.withdrawn))
    )
  }
  // Replies stay with the work until the turn ends, then its last reply becomes the answer.
  // A steering message or compaction starts another block, and in a bot's chat so does a thread
  // marker or a message it sent (a message to another bot joins the exchange line instead).
  const segments: string[] = []
  const lastReplies = new Map<string, string>()
  // A block's time runs from where its segment began, so a live one counts before its first step.
  const segmentStarts = new Map<string, number>()
  for (const [index, item] of items.entries()) {
    const previous = segments.at(-1)
    const before = items[index - 1]
    const segment =
      item.kind === 'user_message' ||
      (item.kind === 'compaction' && item.status !== 'failed') ||
      (turns &&
        ((item.kind === 'thread_marker' && !exchangeEntry(item, bot!.others)) || sentMessage(item)))
        ? item.id
        : previous === undefined || before!.turnId !== item.turnId
          ? item.turnId
          : previous
    segments.push(segment)
    if (!segmentStarts.has(segment)) segmentStarts.set(segment, item.createdAt)
    if (item.kind === 'assistant_message') lastReplies.set(item.turnId, item.id)
  }
  const liveTurnId =
    tail && !outcomes[tail.turnId] && (sessionActive || (running && tail.kind === 'user_message'))
      ? tail.turnId
      : undefined
  const liveSegment = liveTurnId && !(tail && silent(tail)) ? segments.at(-1) : undefined
  const blocks = new Map<string, { row: WorkRow; steps: StepItem[]; next?: ThreadItem }>()
  function openBlock(segment: string, turnId: string) {
    let block = blocks.get(segment)
    if (!block) {
      const row: WorkRow = {
        kind: 'work',
        id: `${segment}:work`,
        turnId,
        activities: [],
        status: 'running',
      }
      block = { row, steps: [] }
      blocks.set(segment, block)
      rows.push(row)
    }
    return block
  }
  // A background subagent the agent talked past gets a line where it finished: its result
  // otherwise arrives as a second answer with nothing to say why.
  const finished = items
    .filter(
      (item): item is SubagentItem =>
        item.kind === 'subagent' && item.status !== 'running' && item.completedAt !== undefined
    )
    .toSorted((a, b) => a.completedAt! - b.completedAt!)
  const launched: SubagentItem[] = []
  const talkedPast = new Set<string>()
  function flushFinished(before: number) {
    while (finished[0] && finished[0].completedAt! <= before) {
      const agent = finished.shift()!
      if (talkedPast.has(agent.id))
        rows.push({ kind: 'subagentDone', id: `${agent.id}:done`, agent })
    }
  }
  let currentTurnId: string | undefined
  const heldTurns = new Set<string>()
  // A message that isn't the first of its turn was steered into it. One shown as sent ahead of
  // the server's copy is steering when a turn is running.
  const startedTurns = new Set<string>()
  const lastSent = items.findLast((item) => item.turnId !== pendingTurnId)
  const steering = sessionActive && lastSent !== undefined && !outcomes[lastSent.turnId]
  // Anything after a held turn that isn't a leftover background-stopped line has resumed it.
  const lastFollowUp = items.findLastIndex((item) => item.kind !== 'background_stopped')
  // The guard also holds a turn that finished before the restart stopped its background work.
  // A monitor or background command's line follows the turn that started it.
  const started: BackgroundItem[] = []
  function finishTurn(resumed: boolean) {
    if (!currentTurnId) return
    for (const item of started.splice(0)) rows.push({ kind: 'background', id: item.id, item })
    const id = `${currentTurnId}:restart`
    if (heldTurns.has(currentTurnId)) rows.push({ kind: 'restartLimit', id, resumed })
    else if (outcomes[currentTurnId] === 'server_restarted') rows.push({ kind: 'restart', id })
  }
  for (const [index, item] of items.entries()) {
    if (currentTurnId && currentTurnId !== item.turnId) finishTurn(lastFollowUp >= index)
    currentTurnId = item.turnId
    const steered = item.turnId !== pendingTurnId && startedTurns.has(item.turnId)
    startedTurns.add(item.turnId)
    if (hidden(item)) continue
    const entry = bot && exchangeEntry(item, bot.others)
    if (entry) {
      // The work between two messages doesn't break the line.
      const last = rows.findLast((row) => row.kind !== 'work')
      if (last?.kind === 'exchange') last.entries.push(entry)
      else rows.push({ kind: 'exchange', id: item.id, entries: [entry] })
      continue
    }
    if (dropped(item) || (bot && item.kind === 'subagent')) continue
    // A finish line sits where the subagent finished, ahead of the turn it woke.
    flushFinished(item.createdAt)
    if (item.kind === 'subagent') launched.push(item)
    if (item.kind === 'assistant_message')
      for (const agent of launched)
        if ((agent.completedAt ?? Infinity) > item.createdAt) talkedPast.add(agent.id)
    const segment = segments[index]!
    if (isStep(item) || (item.kind === 'assistant_message' && foldsIntoWork(item))) {
      const block = openBlock(segment, item.turnId)
      block.steps.push(item)
      block.next = items[index + 1]
      continue
    }
    const last = rows.at(-1)
    switch (item.kind) {
      case 'workflow':
        rows.push({ kind: 'workflow', id: item.id, item })
        break
      case 'user_message':
        rows.push(
          bot && (item.reports?.length || item.wake)
            ? { kind: 'wake', id: item.id, reports: item.reports, wake: item.wake }
            : item.reports?.length
              ? { kind: 'reports', id: item.id, reports: item.reports }
              : {
                  kind: 'user',
                  id: item.id,
                  item,
                  ...(steered && { steered }),
                  ...(steering && item.turnId === pendingTurnId && { steering }),
                }
        )
        break
      case 'assistant_message':
        rows.push({
          kind: 'assistant',
          id: item.id,
          item,
          streaming: textRunning(item, item === tail, sessionRunning),
          loadout: loadouts[item.turnId],
        })
        break
      case 'plan':
        rows.push({
          kind: 'plan',
          id: item.id,
          item,
          streaming: textRunning(item, item === tail, sessionRunning),
          loadout: loadouts[item.turnId],
        })
        break
      case 'thread_marker':
        if (
          last?.kind === 'markers' &&
          item.createdAt - last.markers.at(-1)!.createdAt <= SESSION_GAP
        )
          last.markers.push(item)
        else rows.push({ kind: 'markers', id: item.id, markers: [item] })
        break
      case 'compaction':
        // A compaction that failed, or was cut off with its turn, didn't happen.
        if (bot?.tidying && item.status === 'running') break
        if (item.status === 'completed' || (item.status === 'running' && !outcomes[item.turnId]))
          rows.push({ kind: 'compaction', id: item.id, running: item.status === 'running' })
        break
      case 'error':
        if (item.message === RESTART_LIMIT_NOTE) heldTurns.add(item.turnId)
        else rows.push({ kind: 'error', id: item.id, message: item.message, turnId: item.turnId })
        break
      case 'pull_request':
        rows.push({ kind: 'pullRequest', id: item.id, item })
        break
      case 'background':
        started.push(item)
        break
      case 'background_stopped':
        rows.push({ kind: 'backgroundStopped', id: item.id })
        break
      case 'image_gallery':
        rows.push({ kind: 'gallery', id: item.id, item })
        break
      case 'video':
        rows.push({ kind: 'video', id: item.id, item })
        break
    }
  }
  flushFinished(Infinity)
  // A compaction's seam is the live line until the agent does something after it.
  if (
    liveSegment &&
    tail &&
    !bot?.tidying &&
    items.find((item) => item.id === liveSegment)?.kind !== 'compaction'
  )
    openBlock(liveSegment, tail.turnId)
  finishTurn(false)
  // The main agent's todo calls read as one line each; a subagent's stay ordinary tool calls.
  const todos = agentId ? undefined : foldTodos(allItems).updates
  for (const [segment, { row, steps, next }] of blocks) {
    row.activities = steps.flatMap((item, index): WorkActivity[] => {
      if (!todos?.has(item.id))
        return [
          toActivity(
            item,
            steps[index + 1] ?? next,
            sessionRunning,
            sessionActive,
            projectPath,
            item.agentId ? agentTitles.get(item.agentId) : undefined,
            waitingAgents
          ),
        ]
      const update = todos.get(item.id)
      return update ? [{ type: 'todo', id: item.id, update }] : []
    })
    row.status = workStatus(row.activities, outcomes[row.turnId], segment === liveSegment)
    if (outcomes[row.turnId] === 'server_restarted') row.restarted = true
    const answerEnd =
      next?.turnId === row.turnId && next.kind !== 'compaction' ? next.completedAt : undefined
    const start = segmentStarts.get(segment)!
    if (row.status === 'running') row.startedAt = start
    else if (row.status !== 'waiting' && steps.length > 0)
      row.elapsedSeconds =
        answerEnd === undefined ? elapsedSeconds(steps, next, start) : (answerEnd - start) / 1000
  }
  const lastWork = rows.findLast((row) => row.kind === 'work')
  if (status === 'awaiting_approval' && lastWork && lastWork.turnId === tail?.turnId) {
    lastWork.status = 'waiting'
    lastWork.startedAt = undefined
    lastWork.elapsedSeconds = undefined
  }
  // A first message waits on the worktree's setup before the agent starts.
  if (settingUp && lastWork?.status === 'running') lastWork.settingUp = true
  stitchRuns(rows)
  if (bot?.tidying) rows.push({ kind: 'tidying', id: 'tidying' })
  return reuseRows(allItems[0], groupPullRequestRows(rows))
}

function groupPullRequestRows(rows: ThreadRow[]): ThreadRow[] {
  const grouped: ThreadRow[] = []
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!
    if (row.kind !== 'pullRequest') {
      grouped.push(row)
      index++
      continue
    }
    const items = new Map<string, PullRequestItem>()
    const id = row.id
    while (rows[index]?.kind === 'pullRequest') {
      const item = (rows[index] as Extract<ThreadRow, { kind: 'pullRequest' }>).item
      const key = `${item.repo}#${item.number}`
      const previous = items.get(key)
      items.set(
        key,
        previous
          ? {
              ...previous,
              activity: [...previous.activity, ...item.activity],
              held: previous.held || item.held,
            }
          : item
      )
      index++
    }
    const pulls = [...items.values()]
    grouped.push(
      pulls.length === 1
        ? { kind: 'pullRequest', id, item: pulls[0]! }
        : { kind: 'pullRequestGroup', id, items: pulls }
    )
  }
  return grouped
}

// Copy only the final response once the agent has finished working.
function stitchRuns(rows: ThreadRow[]) {
  let last: Extract<ThreadRow, { kind: 'assistant' | 'plan' }> | undefined
  let working = false
  function close() {
    if (last && !working) last.footer = last.item.text
    last = undefined
    working = false
  }
  for (const row of rows) {
    if (
      row.kind === 'user' ||
      row.kind === 'wake' ||
      row.kind === 'markers' ||
      row.kind === 'exchange'
    )
      close()
    else if (row.kind === 'assistant' || row.kind === 'plan') {
      last = row
    } else if (row.kind === 'work' && (row.status === 'running' || row.status === 'waiting'))
      working = true
  }
  close()
}

const previousRows = new WeakMap<ThreadItem, Map<string, ThreadRow>>()

// Rows equal to the last call's keep their identity, so a streaming delta re-renders only the
// row it changed. Keyed by the thread's first item, which outlives every delta and goes with the
// thread.
function reuseRows(first: ThreadItem | undefined, rows: ThreadRow[]) {
  if (!first) return rows
  const previous = previousRows.get(first)
  const next = new Map<string, ThreadRow>()
  for (const [index, row] of rows.entries()) {
    const old = previous?.get(row.id)
    if (old && same(old, row)) rows[index] = old
    next.set(row.id, rows[index]!)
  }
  previousRows.set(first, next)
  return rows
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return a === b
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) {
    const x = a[key as keyof typeof a]
    const y = b[key as keyof typeof b]
    if (x !== y && !same(x, y)) return false
  }
  return true
}

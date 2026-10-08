import type { SessionStatus, TurnLoadout } from '@jetty/shared/events'
import type { TurnOutcome } from '@jetty/shared/reducer'
import type { QueuedMessage } from '@jetty/shared/wire'

import { createItemSelection, itemDeltasSince } from '@/state/item_selection'
import { isQueuedEditing } from '@/state/queue_editing'
import { pendingTurnId } from '@/state/turns'
import {
  awaitsInput,
  RESTART_LIMIT_NOTE,
  type ChildReport,
  type ThreadItem,
} from '@jetty/shared/items'
import { claudeModelLabel } from '@jetty/shared/model-name'

import type { Subagent } from './subagent_row'
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
type WorkRow = Extract<ThreadRow, { kind: 'work' }>
export type SubagentItem = Extract<ThreadItem, { kind: 'subagent' }>
type WorkflowItem = Extract<ThreadItem, { kind: 'workflow' }>
export type PullRequestItem = Extract<ThreadItem, { kind: 'pull_request' }>

export type QueueState = 'queued' | 'paused' | 'editing' | 'sending'

export type ThreadRow =
  // steered: it went into a running turn; steering: on its way into one
  | { kind: 'user'; id: string; item: UserItem; steered?: boolean; steering?: boolean }
  | { kind: 'reports'; id: string; reports: readonly ChildReport[] }
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
  // the crash-loop guard held the turn; resumed once anything follows it
  | { kind: 'restartLimit'; id: string; resumed: boolean }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'gallery'; id: string; item: GalleryItem }
  | { kind: 'video'; id: string; item: VideoItem }
  // a settled approval or question; pending ones live in the composer strip
  | { kind: 'marker'; id: string; item: ApprovalItem | QuestionItem; source?: string }
  | { kind: 'subagents'; id: string; agents: SubagentItem[] }
  | { kind: 'workflow'; id: string; item: WorkflowItem }
  // The queue under the chat: a seam with its state, the user's queued messages, and Undo where
  // one was just removed. Resume sends the queue's next message.
  | {
      kind: 'queueSeam'
      id: string
      state: QueueState
      count: number
      // queued messages the chat doesn't show: relays, reports, Jetty's own notes
      waiting?: number
      resume?: QueuedMessage
    }
  | { kind: 'queued'; id: string; entry: QueuedMessage; editing: boolean; steer: boolean }
  | { kind: 'queueRemoved'; id: string }

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
  say: {
    action: 'Send message',
    words: words('Sending', 'Sent', 'message'),
    target: (input) => (typeof input.text === 'string' ? input.text : undefined),
  },
  react: {
    action: 'React',
    words: words('Reacting', 'Reacted', 'reaction'),
    target: (input) => (typeof input.emoji === 'string' ? input.emoji : undefined),
  },
  list_threads: {
    action: 'List threads',
    words: words('Listing', 'Listed', 'thread list'),
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
  mark_ready_for_review: {
    action: 'Mark ready for review',
    words: words('Marking', 'Marked', 'review'),
    target: (input) => (typeof input.summary === 'string' ? input.summary : 'this thread'),
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
  span: readonly WorkItem[],
  next: ThreadItem | undefined,
  start = span[0]!.createdAt
) {
  const ends = span.map((item) => item.completedAt)
  if (ends.every((end): end is number => end !== undefined))
    return (Math.max(...ends) - start) / 1000
  return next?.turnId === span[0]!.turnId ? (next.createdAt - start) / 1000 : undefined
}

function toActivity(
  item: WorkItem,
  next: ThreadItem | undefined,
  sessionRunning: boolean,
  sessionActive: boolean,
  projectPath: string | undefined
): WorkActivity {
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
  return {
    type: 'tool',
    id: item.id,
    kind: toolKind(item.toolName),
    name,
    words: jetty?.words,
    target: jetty
      ? (jetty.target(fields, item.output) ?? jetty.words.singular)
      : mcpTool(item.toolName)
        ? name
        : toolTarget(item.toolName, item.input, projectPath),
    description: toolDescription(item.input),
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

function createdThreadId(item: ThreadItem) {
  if (
    item.kind !== 'tool_call' ||
    item.status !== 'succeeded' ||
    item.toolName !== 'mcp__jetty__create_thread'
  )
    return undefined
  return resultField(item.output, 'threadId')
}

// Before the subagent's first reply its model is unknown; its type stands in.
export function subagentLabel({ model }: { model?: string }) {
  return model ? claudeModelLabel(model) : ''
}

export function toSubagent(item: SubagentItem, now: number): Subagent {
  return {
    id: item.id,
    title: item.title,
    model: subagentLabel(item),
    status:
      item.status === 'running'
        ? 'working'
        : item.status === 'completed'
          ? 'complete'
          : item.status === 'stopped'
            ? 'stopped'
            : 'error',
    elapsedSeconds:
      (item.durationMs ?? Math.max(0, (item.completedAt ?? now) - item.createdAt)) / 1000,
    tokens: item.tokens ?? 0,
  }
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
  // what waits to be sent, shown under the chat
  queue?: TranscriptQueue
}

type LastTurn = { start: number; row: number }

// Where the last turn starts in the items and the rows, when its rows can be built on their own:
// it opens with a message of the user's, which closes the answer before it, and nothing reaches
// into it from earlier turns (subagents and their finish lines, the task list).
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
  const row = rows.findLastIndex((row) => row.kind === 'user' && row.id === first.id)
  return row === -1 ? undefined : { start, row }
}

function sameOptions(a: ThreadRowsOptions, b: ThreadRowsOptions) {
  const keys = Object.keys(a) as (keyof ThreadRowsOptions)[]
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

// A thread's rows as it changes. A delta into the last turn builds only that turn's rows again,
// after the earlier ones as they were; anything else builds them all.
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
    queue,
  }: ThreadRowsOptions
): ThreadRow[] {
  // A subagent's requests for input also surface on the main timeline, attributed to it.
  const items = allItems.filter(
    (item) =>
      item.agentId === agentId ||
      (!agentId && (item.kind === 'approval' || item.kind === 'question'))
  )
  const agentTitles = new Map(
    agentId ? [] : threadSubagents(allItems).map((agent) => [agent.id, agent.title])
  )
  const rows: ThreadRow[] = []
  const agent = agentId && allItems.find((item) => item.id === agentId)
  if (agent && agent.kind === 'subagent' && agent.prompt) {
    const { turnId, createdAt, prompt } = agent
    const id = `${agent.id}:prompt`
    rows.push({
      kind: 'user',
      id,
      item: { id, turnId, createdAt, kind: 'user_message', text: prompt, attachments: [] },
    })
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
  // An answered question shows as its answer, and a denied tool as its Denied marker; Claude
  // loading a deferred tool's schema (ToolSearch) is plumbing, not work. Jetty's note to the agent
  // after a restart is for the agent: the restart's seam tells the user.
  function hidden(item: ThreadItem) {
    return (
      isAnsweredQuestionTool(item) ||
      (item.kind === 'tool_call' && item.status !== 'succeeded' && deniedTools.has(item.id)) ||
      (item.kind === 'tool_call' && item.toolName === 'ToolSearch') ||
      (item.kind === 'user_message' && item.from?.threadId === threadId && !item.reports)
    )
  }
  function isStep(item: ThreadItem): item is WorkItem {
    return (item.kind === 'reasoning' || item.kind === 'tool_call') && !hidden(item)
  }
  // A turn's steps share one work block until the agent says something: every message it writes
  // shows in the chat, and the steps after it start the next block. A steering message or a
  // compaction starts another too.
  const segments: string[] = []
  // A block's time runs from where its segment began, so a live one counts before its first step.
  const segmentStarts = new Map<string, number>()
  for (const [index, item] of items.entries()) {
    const previous = segments.at(-1)
    const before = items[index - 1]
    const segment =
      item.kind === 'user_message' || (item.kind === 'compaction' && item.status !== 'failed')
        ? item.id
        : previous === undefined || before!.turnId !== item.turnId
          ? item.turnId
          : before!.kind === 'assistant_message' && item.kind !== 'assistant_message'
            ? before!.id
            : previous
    segments.push(segment)
    if (!segmentStarts.has(segment)) segmentStarts.set(segment, item.createdAt)
  }
  const liveSegment =
    tail && !outcomes[tail.turnId] && (sessionActive || (running && tail.kind === 'user_message'))
      ? segments.at(-1)
      : undefined
  const blocks = new Map<string, { row: WorkRow; steps: WorkItem[]; next?: ThreadItem }>()
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
  function finishTurn(resumed: boolean) {
    if (!currentTurnId) return
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
    // A finish line sits where the subagent finished, ahead of the turn it woke.
    flushFinished(item.createdAt)
    if (item.kind === 'subagent') launched.push(item)
    const segment = segments[index]!
    if (isStep(item)) {
      const block = openBlock(segment, item.turnId)
      block.steps.push(item)
      block.next = items[index + 1]
      continue
    }
    if (segment === liveSegment && item.kind === 'assistant_message')
      openBlock(segment, item.turnId)
    const last = rows.at(-1)
    switch (item.kind) {
      case 'subagent':
        if (last?.kind === 'subagents') last.agents.push(item)
        else rows.push({ kind: 'subagents', id: item.id, agents: [item] })
        break
      case 'workflow':
        rows.push({ kind: 'workflow', id: item.id, item })
        break
      case 'user_message':
        rows.push(
          item.reports?.length
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
        for (const agent of launched)
          if ((agent.completedAt ?? Infinity) > item.createdAt) talkedPast.add(agent.id)
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
      case 'compaction':
        // A compaction that failed, or was cut off with its turn, didn't happen.
        if (item.status === 'completed' || (item.status === 'running' && !outcomes[item.turnId]))
          rows.push({ kind: 'compaction', id: item.id, running: item.status === 'running' })
        break
      case 'error':
        if (item.message === RESTART_LIMIT_NOTE) heldTurns.add(item.turnId)
        else rows.push({ kind: 'error', id: item.id, message: item.message })
        break
      case 'pull_request':
        rows.push({ kind: 'pullRequest', id: item.id, item })
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
      case 'approval':
      case 'question':
        if (!awaitsInput(item))
          rows.push({
            kind: 'marker',
            id: item.id,
            item,
            source: item.agentId && agentTitles.get(item.agentId),
          })
        break
    }
  }
  flushFinished(Infinity)
  // A compaction's seam is the live line until the agent does something after it.
  if (liveSegment && tail && items.find((item) => item.id === liveSegment)?.kind !== 'compaction')
    openBlock(liveSegment, tail.turnId)
  finishTurn(false)
  // The main agent's todo calls read as one line each; a subagent's stay ordinary tool calls.
  const todos = agentId ? undefined : foldTodos(allItems).updates
  for (const [segment, { row, steps, next }] of blocks) {
    row.activities = steps.flatMap((item, index): WorkActivity[] => {
      const created = createdThreadId(item)
      if (created && item.kind === 'tool_call') {
        const { title } = item.input as { title?: unknown }
        return [
          {
            type: 'created',
            id: item.id,
            threadId: created,
            ...(typeof title === 'string' && { title }),
          },
        ]
      }
      if (!todos?.has(item.id))
        return [
          toActivity(item, steps[index + 1] ?? next, sessionRunning, sessionActive, projectPath),
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
  if (queue) rows.push(...queueRows(queue, running))
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

// The agent's messages between two of the user's read as one answer, whatever lands between
// them (a report, a finish line, more work): one footer at the end, copying the whole run. A run
// the agent is still working on has no end yet, so no footer.
function stitchRuns(rows: ThreadRow[]) {
  let run: Extract<ThreadRow, { kind: 'assistant' | 'plan' }>[] = []
  let working = false
  function close() {
    const last = run.at(-1)
    if (last && !working) last.footer = run.map((row) => row.item.text).join('\n\n')
    run = []
    working = false
  }
  for (const row of rows) {
    if (row.kind === 'user') close()
    else if (row.kind === 'assistant' || row.kind === 'plan') {
      run.push(row)
      working = false
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

export type TranscriptQueue = {
  // the whole queue, what of it isn't in the chat yet, and the user's own messages among that
  queued: readonly QueuedMessage[]
  unsent: readonly QueuedMessage[]
  own: readonly QueuedMessage[]
  paused: boolean
  // the crash-loop guard held the thread: its own seam's Resume continues it, so the queue's waits
  held: boolean
  editing?: string
  removed?: { message: QueuedMessage; index: number }
}

// The queue as B in the sketchpad's queued messages: a seam, then each of the user's messages
// in order, with Undo in a removed one's place. Other threads' messages wait unseen, but a paused
// queue still shows its seam for them and how many are waiting.
function queueRows(
  { queued, unsent, own, paused, held, editing, removed }: TranscriptQueue,
  running: boolean
): ThreadRow[] {
  const rows: ThreadRow[] = []
  const head = own[0]
  const waiting = unsent.length - own.length
  if (!held && (head || (paused && unsent.length > 0))) {
    const resume = unsent.find((entry) => !isQueuedEditing(entry, editing))
    rows.push({
      kind: 'queueSeam',
      id: 'queue:seam',
      state: paused
        ? 'paused'
        : running
          ? 'queued'
          : head && isQueuedEditing(head, editing)
            ? 'editing'
            : 'sending',
      count: own.length,
      ...(paused && waiting > 0 && { waiting }),
      ...(paused && resume && { resume }),
    })
  }
  const first = rows.length
  for (const entry of own)
    rows.push({
      kind: 'queued',
      id: `${entry.id}:queued`,
      entry,
      editing: isQueuedEditing(entry, editing),
      steer: running,
    })
  if (removed && !queued.some((entry) => entry.id === removed.message.id)) {
    const before = own.filter((entry) => queued.indexOf(entry) < removed.index).length
    rows.splice(first + before, 0, { kind: 'queueRemoved', id: `${removed.message.id}:removed` })
  }
  return rows
}

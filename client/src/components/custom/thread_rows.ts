import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'
import type { TurnOutcome } from '@jetty/shared/reducer'

import { awaitsInput } from '@/state/thread_tab'

import type { Subagent } from './subagent_row'
import type { ActivityStatus, ToolKind, ToolWords, WorkActivity } from './work_model'

type UserItem = Extract<ThreadItem, { kind: 'user_message' }>
type AssistantItem = Extract<ThreadItem, { kind: 'assistant_message' }>
type PlanItem = Extract<ThreadItem, { kind: 'plan' }>
type ApprovalItem = Extract<ThreadItem, { kind: 'approval' }>
type QuestionItem = Extract<ThreadItem, { kind: 'question' }>
type GalleryItem = Extract<ThreadItem, { kind: 'image_gallery' }>
type VideoItem = Extract<ThreadItem, { kind: 'video' }>
type WorkItem = Extract<ThreadItem, { kind: 'reasoning' | 'tool_call' }>
type StepItem = WorkItem | AssistantItem
type WorkRow = Extract<ThreadRow, { kind: 'work' }>
export type SubagentItem = Extract<ThreadItem, { kind: 'subagent' }>
type WorkflowItem = Extract<ThreadItem, { kind: 'workflow' }>

export type ThreadRow =
  | { kind: 'user'; id: string; item: UserItem }
  | { kind: 'assistant'; id: string; item: AssistantItem; streaming: boolean }
  | { kind: 'plan'; id: string; item: PlanItem; streaming: boolean }
  | {
      kind: 'work'
      id: string
      turnId: string
      activities: WorkActivity[]
      status: ActivityStatus
      elapsedSeconds?: number
      restarted?: boolean
    }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'gallery'; id: string; item: GalleryItem }
  | { kind: 'video'; id: string; item: VideoItem }
  // a settled approval or question; pending ones live in the composer strip
  | { kind: 'marker'; id: string; item: ApprovalItem | QuestionItem; source?: string }
  | { kind: 'subagents'; id: string; agents: SubagentItem[] }
  | { kind: 'workflow'; id: string; item: WorkflowItem }
  | { kind: 'created'; id: string; threadIds: string[] }

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
}

function words(active: string, done: string, singular: string, noun = `${singular}s`) {
  return { active, done, singular, noun }
}

const jettyTools: Record<string, JettyTool> = {
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
  for (const key of ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'text']) {
    const value = record[key]
    if (typeof value !== 'string' || !value) continue
    return pathKeys.has(key) ? projectRelative(value, projectPath) : value
  }
  return name
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

function elapsedSeconds(span: readonly StepItem[], next: ThreadItem | undefined) {
  const start = span[0]!
  const ends = span.map((item) => item.completedAt)
  if (ends.every((end): end is number => end !== undefined))
    return (Math.max(...ends) - start.createdAt) / 1000
  return next?.turnId === start.turnId ? (next.createdAt - start.createdAt) / 1000 : undefined
}

function toActivity(
  item: StepItem,
  next: ThreadItem | undefined,
  sessionRunning: boolean,
  sessionActive: boolean,
  projectPath: string | undefined
): WorkActivity {
  if (item.kind === 'assistant_message') return { type: 'text', id: item.id, text: item.text }
  if (item.kind === 'reasoning') {
    const running = textRunning(item, !next, sessionRunning)
    return {
      type: 'thinking',
      id: item.id,
      status: !running ? 'complete' : sessionActive ? 'running' : 'interrupted',
      summary: item.text,
      tokens: item.tokens,
      elapsedSeconds: running
        ? Math.max(0, (Date.now() - item.createdAt) / 1000)
        : elapsedSeconds([item], next),
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
    status:
      item.status === 'failed'
        ? 'failed'
        : item.status === 'succeeded'
          ? 'complete'
          : sessionActive
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
  if (outcome && outcome !== 'server_restarted')
    return outcome === 'completed' ? 'complete' : outcome
  if (live) return 'running'
  for (const status of ['waiting', 'running', 'interrupted'] as const)
    if (activities.some((activity) => activity.type !== 'text' && activity.status === status))
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

// claude-sonnet-5 → Sonnet 5, claude-opus-4-6 → Opus 4.6; aliases like `sonnet` stay a family name.
function modelLabel(model: string | undefined) {
  if (!model) return ''
  const [family = '', ...version] = model.replace(/^claude-/, '').split('-')
  const label = family.charAt(0).toUpperCase() + family.slice(1)
  const numbers = version.filter((part) => /^\d{1,2}$/.test(part))
  return numbers.length ? `${label} ${numbers.join('.')}` : label
}

// Before the subagent's first reply its model is unknown; its type stands in.
export function subagentLabel({ model }: { model?: string }) {
  return modelLabel(model)
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

export function threadSubagents(items: readonly ThreadItem[]) {
  return items.filter((item): item is SubagentItem => item.kind === 'subagent')
}

export function threadRows(
  allItems: readonly ThreadItem[],
  {
    status,
    running,
    outcomes = {},
    projectPath,
    agentId,
  }: {
    status: SessionStatus
    running: boolean
    outcomes?: Readonly<Record<string, TurnOutcome>>
    projectPath?: string
    agentId?: string
  }
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
  function isAnsweredQuestionTool(item: ThreadItem) {
    return (
      item.kind === 'tool_call' &&
      item.toolName === 'AskUserQuestion' &&
      askedTurns.has(item.turnId)
    )
  }
  function isStep(item: ThreadItem): item is WorkItem {
    return (
      (item.kind === 'reasoning' || item.kind === 'tool_call') &&
      !createdThreadId(item) &&
      !isAnsweredQuestionTool(item)
    )
  }
  // A turn's steps, and the text between them, share one work block; a steering message starts
  // another. Text after the last step stays outside the block as the answer.
  const segments: string[] = []
  const lastStep = new Map<string, number>()
  for (const [index, item] of items.entries()) {
    const previous = segments.at(-1)
    const segment =
      item.kind === 'user_message'
        ? item.id
        : previous !== undefined && items[index - 1]!.turnId === item.turnId
          ? previous
          : item.turnId
    segments.push(segment)
    if (isStep(item)) lastStep.set(segment, index)
  }
  const liveSegment =
    tail && !outcomes[tail.turnId] && (sessionActive || (running && tail.kind === 'user_message'))
      ? segments.at(-1)
      : undefined
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
  let currentTurnId: string | undefined
  function finishTurn() {
    if (!currentTurnId || outcomes[currentTurnId] !== 'server_restarted') return
    const lastRow = rows.at(-1)
    if (lastRow?.kind === 'work' && lastRow.turnId === currentTurnId) {
      lastRow.restarted = true
      return
    }
    rows.push({
      kind: 'work',
      id: `${currentTurnId}:restarted`,
      turnId: currentTurnId,
      activities: [],
      status: 'interrupted',
      restarted: true,
    })
  }
  for (const [index, item] of items.entries()) {
    if (currentTurnId && currentTurnId !== item.turnId) finishTurn()
    currentTurnId = item.turnId
    if (isAnsweredQuestionTool(item)) continue
    const segment = segments[index]!
    if (
      isStep(item) ||
      (item.kind === 'assistant_message' && index < (lastStep.get(segment) ?? -1))
    ) {
      const block = openBlock(segment, item.turnId)
      block.steps.push(item)
      block.next = items[index + 1]
      continue
    }
    if (segment === liveSegment && item.kind === 'assistant_message')
      openBlock(segment, item.turnId)
    const last = rows.at(-1)
    const created = createdThreadId(item)
    if (created) {
      if (last?.kind === 'created') last.threadIds.push(created)
      else rows.push({ kind: 'created', id: item.id, threadIds: [created] })
      continue
    }
    switch (item.kind) {
      case 'subagent':
        if (last?.kind === 'subagents') last.agents.push(item)
        else rows.push({ kind: 'subagents', id: item.id, agents: [item] })
        break
      case 'workflow':
        rows.push({ kind: 'workflow', id: item.id, item })
        break
      case 'user_message':
        rows.push({ kind: 'user', id: item.id, item })
        break
      case 'assistant_message':
        rows.push({
          kind: 'assistant',
          id: item.id,
          item,
          streaming: textRunning(item, item === tail, sessionRunning),
        })
        break
      case 'plan':
        rows.push({
          kind: 'plan',
          id: item.id,
          item,
          streaming: textRunning(item, item === tail, sessionRunning),
        })
        break
      case 'error':
        rows.push({ kind: 'error', id: item.id, message: item.message })
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
  if (liveSegment && tail) openBlock(liveSegment, tail.turnId)
  finishTurn()
  for (const [segment, { row, steps, next }] of blocks) {
    row.activities = steps.map((item, index) =>
      toActivity(item, steps[index + 1] ?? next, sessionRunning, sessionActive, projectPath)
    )
    row.status = row.restarted
      ? 'interrupted'
      : workStatus(row.activities, outcomes[row.turnId], segment === liveSegment)
    if (row.status !== 'running' && row.status !== 'waiting' && steps.length > 0)
      row.elapsedSeconds = elapsedSeconds(steps, next)
  }
  const lastWork = rows.findLast((row) => row.kind === 'work')
  if (status === 'awaiting_approval' && lastWork && lastWork.turnId === tail?.turnId) {
    lastWork.status = 'waiting'
    lastWork.elapsedSeconds = undefined
  }
  return rows
}

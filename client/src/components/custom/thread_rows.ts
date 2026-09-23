import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'
import type { TurnOutcome } from '@jetty/shared/reducer'

import type { Subagent } from './subagent_row'
import type { ActivityStatus, ToolKind, WorkActivity } from './work_model'

type UserItem = Extract<ThreadItem, { kind: 'user_message' }>
type AssistantItem = Extract<ThreadItem, { kind: 'assistant_message' }>
type PlanItem = Extract<ThreadItem, { kind: 'plan' }>
type QuestionItem = Extract<ThreadItem, { kind: 'question' }>
type GalleryItem = Extract<ThreadItem, { kind: 'image_gallery' }>
type VideoItem = Extract<ThreadItem, { kind: 'video' }>
type WorkItem = Extract<ThreadItem, { kind: 'reasoning' | 'tool_call' | 'approval' }>
export type SubagentItem = Extract<ThreadItem, { kind: 'subagent' }>

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
    }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'gallery'; id: string; item: GalleryItem }
  | { kind: 'video'; id: string; item: VideoItem }
  | { kind: 'question'; id: string; item: QuestionItem }
  | { kind: 'subagents'; id: string; agents: SubagentItem[] }

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

function toolTarget(name: string, input: unknown, projectPath: string | undefined) {
  if (!input || typeof input !== 'object') return name
  const record = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'text']) {
    const value = record[key]
    if (typeof value !== 'string' || !value) continue
    return pathKeys.has(key) ? projectRelative(value, projectPath) : value
  }
  return name
}

function projectRelative(path: string, projectPath: string | undefined) {
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

function elapsedSeconds(span: readonly WorkItem[], next: ThreadItem | undefined) {
  const start = span[0]!
  const ends = span.map((item) => item.completedAt)
  if (ends.every((end): end is number => end !== undefined))
    return (Math.max(...ends) - start.createdAt) / 1000
  return next?.turnId === start.turnId ? (next.createdAt - start.createdAt) / 1000 : undefined
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
      elapsedSeconds: running
        ? Math.max(0, (Date.now() - item.createdAt) / 1000)
        : elapsedSeconds([item], next),
    }
  }
  const input = typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2)
  if (item.kind === 'approval')
    return {
      type: 'tool',
      id: item.id,
      kind: 'generic',
      name: item.toolName,
      target: item.title || item.toolName,
      status:
        item.decision === 'allow' ? 'complete' : item.decision === 'deny' ? 'cancelled' : 'waiting',
      input,
      output:
        item.decision === 'allow'
          ? 'Allowed'
          : item.decision === 'deny'
            ? `Denied${item.deniedReason ? `: ${item.deniedReason}` : ''}`
            : undefined,
    }
  return {
    type: 'tool',
    id: item.id,
    kind: toolKind(item.toolName),
    name: item.toolName,
    target: toolTarget(item.toolName, item.input, projectPath),
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

function workStatus(
  activities: readonly WorkActivity[],
  outcome: TurnOutcome | undefined
): ActivityStatus {
  if (outcome) return outcome === 'completed' ? 'complete' : outcome
  for (const status of ['waiting', 'running', 'interrupted'] as const)
    if (activities.some((activity) => activity.status === status)) return status
  return 'complete'
}

function isWork(item: ThreadItem): item is WorkItem {
  return item.kind === 'reasoning' || item.kind === 'tool_call' || item.kind === 'approval'
}

// claude-sonnet-5 → Sonnet 5, claude-opus-4-6 → Opus 4.6; aliases like `sonnet` stay a family name.
function modelLabel(model: string | undefined) {
  if (!model) return ''
  const [family = '', ...version] = model.replace(/^claude-/, '').split('-')
  const label = family.charAt(0).toUpperCase() + family.slice(1)
  const numbers = version.filter((part) => /^\d{1,2}$/.test(part))
  return numbers.length ? `${label} ${numbers.join('.')}` : label
}

export function toSubagent(item: SubagentItem, now: number): Subagent {
  return {
    id: item.id,
    title: item.title,
    model: modelLabel(item.model),
    status:
      item.status === 'running' ? 'working' : item.status === 'completed' ? 'complete' : 'error',
    elapsedSeconds:
      item.durationMs != null ? item.durationMs / 1000 : Math.max(0, (now - item.createdAt) / 1000),
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
  const items = allItems.filter((item) => item.agentId === agentId)
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
  const tailId = items.at(-1)?.id
  const sessionRunning = status === 'running' || status === 'starting'
  const sessionActive = sessionRunning || status === 'awaiting_approval'
  const askedTurns = new Set(
    items.filter((item) => item.kind === 'question').map((item) => item.turnId)
  )
  let pending: WorkItem[] = []
  function flush(next: ThreadItem | undefined) {
    if (pending.length === 0) return
    const activities = pending.map((item, index) =>
      toActivity(item, pending[index + 1] ?? next, sessionRunning, sessionActive, projectPath)
    )
    const blockStatus = workStatus(activities, outcomes[pending[0]!.turnId])
    rows.push({
      kind: 'work',
      id: pending[0]!.id,
      turnId: pending[0]!.turnId,
      activities,
      status: blockStatus,
      elapsedSeconds:
        blockStatus === 'running' || blockStatus === 'waiting'
          ? undefined
          : elapsedSeconds(pending, next),
    })
    pending = []
  }
  for (const item of items) {
    if (
      item.kind === 'tool_call' &&
      item.toolName === 'AskUserQuestion' &&
      askedTurns.has(item.turnId)
    )
      continue
    if (isWork(item)) {
      pending.push(item)
      continue
    }
    flush(item)
    const last = rows.at(-1)
    switch (item.kind) {
      case 'subagent':
        if (last?.kind === 'subagents') last.agents.push(item)
        else rows.push({ kind: 'subagents', id: item.id, agents: [item] })
        break
      case 'user_message':
        rows.push({ kind: 'user', id: item.id, item })
        break
      case 'assistant_message':
        rows.push({
          kind: 'assistant',
          id: item.id,
          item,
          streaming: textRunning(item, item.id === tailId, sessionRunning),
        })
        break
      case 'plan':
        rows.push({
          kind: 'plan',
          id: item.id,
          item,
          streaming: textRunning(item, item.id === tailId, sessionRunning),
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
      case 'question':
        rows.push({ kind: 'question', id: item.id, item })
        break
    }
  }
  flush(undefined)
  const last = items.at(-1)
  if (running && last?.kind === 'user_message')
    rows.push({
      kind: 'work',
      id: 'working',
      turnId: last.turnId,
      activities: [],
      status: 'running',
    })
  const lastWork = rows.findLast((row) => row.kind === 'work')
  if (status === 'awaiting_approval' && lastWork && lastWork.turnId === last?.turnId) {
    lastWork.status = 'waiting'
    lastWork.elapsedSeconds = undefined
  }
  return rows
}

import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import type { ActivityStatus, ToolActivity, ToolKind, WorkActivity } from './work_model'

type UserItem = Extract<ThreadItem, { kind: 'user_message' }>
type AssistantItem = Extract<ThreadItem, { kind: 'assistant_message' }>
type PlanItem = Extract<ThreadItem, { kind: 'plan' }>
type QuestionItem = Extract<ThreadItem, { kind: 'question' }>
type GalleryItem = Extract<ThreadItem, { kind: 'image_gallery' }>
type VideoItem = Extract<ThreadItem, { kind: 'video' }>

export type WorkRow = {
  kind: 'work'
  id: string
  activities: WorkActivity[]
  status: ActivityStatus
}

export type ThreadRow =
  | { kind: 'user'; id: string; item: UserItem }
  | { kind: 'assistant'; id: string; item: AssistantItem; streaming: boolean }
  | { kind: 'plan'; id: string; item: PlanItem; streaming: boolean }
  | WorkRow
  | { kind: 'error'; id: string; message: string }
  | { kind: 'gallery'; id: string; item: GalleryItem }
  | { kind: 'video'; id: string; item: VideoItem }
  | { kind: 'question'; id: string; item: QuestionItem }

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

function toolTarget(name: string, input: unknown) {
  if (!input || typeof input !== 'object') return name
  const record = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'text']) {
    const value = record[key]
    if (typeof value === 'string' && value) return value
  }
  return name
}

function toolInput(input: unknown) {
  if (typeof input === 'string') return input
  return JSON.stringify(input, null, 2)
}

function elapsed(createdAt: number, running: boolean) {
  if (!running) return undefined
  return Math.max(0, (Date.now() - createdAt) / 1000)
}

function textRunning(
  item: { streaming?: boolean },
  isThreadTail: boolean,
  sessionRunning: boolean
) {
  if (item.streaming === true) return true
  if (item.streaming === false) return false
  return isThreadTail && sessionRunning
}

function toActivity(
  item: ThreadItem,
  isThreadTail: boolean,
  sessionRunning: boolean
): WorkActivity {
  if (item.kind === 'reasoning') {
    const running = textRunning(item, isThreadTail, sessionRunning)
    return {
      type: 'thinking',
      id: item.id,
      status: running ? 'running' : 'complete',
      summary: item.text,
      tokens: item.tokens,
      elapsedSeconds: elapsed(item.createdAt, running),
    }
  }
  if (item.kind === 'approval') {
    const status: ActivityStatus =
      item.decision === 'allow' ? 'complete' : item.decision === 'deny' ? 'cancelled' : 'waiting'
    const output =
      item.decision === 'allow'
        ? 'Allowed'
        : item.decision === 'deny'
          ? `Denied${item.deniedReason ? `: ${item.deniedReason}` : ''}`
          : undefined
    return {
      type: 'tool',
      id: item.id,
      kind: 'generic',
      name: item.toolName,
      target: item.title || item.toolName,
      status,
      input: toolInput(item.input),
      output,
    }
  }
  const call = item as Extract<ThreadItem, { kind: 'tool_call' }>
  const status: ToolActivity['status'] =
    call.status === 'failed' ? 'failed' : call.status === 'succeeded' ? 'complete' : 'running'
  return {
    type: 'tool',
    id: call.id,
    kind: toolKind(call.toolName),
    name: call.toolName,
    target: toolTarget(call.toolName, call.input),
    status,
    input: toolInput(call.input),
    output: call.output,
    error: call.status === 'failed' ? call.output : undefined,
    elapsedSeconds: elapsed(call.createdAt, status === 'running'),
  }
}

function workStatus(activities: readonly WorkActivity[]): ActivityStatus {
  if (activities.some((activity) => activity.type === 'tool' && activity.status === 'waiting'))
    return 'waiting'
  if (activities.some((activity) => activity.status === 'running')) return 'running'
  if (activities.some((activity) => activity.status === 'failed')) return 'failed'
  return 'complete'
}

function workRow(
  items: readonly ThreadItem[],
  tailId: string | undefined,
  sessionRunning: boolean
): WorkRow {
  const activities = items.map((item) => toActivity(item, item.id === tailId, sessionRunning))
  return {
    kind: 'work',
    id: items[0]!.id,
    activities,
    status: workStatus(activities),
  }
}

function isWork(item: ThreadItem) {
  return item.kind === 'reasoning' || item.kind === 'tool_call' || item.kind === 'approval'
}

export function threadRows(items: readonly ThreadItem[], status: SessionStatus): ThreadRow[] {
  const rows: ThreadRow[] = []
  const tailId = items.at(-1)?.id
  const sessionRunning = status === 'running' || status === 'starting'
  let pending: ThreadItem[] = []
  function flush() {
    if (pending.length === 0) return
    rows.push(workRow(pending, tailId, sessionRunning))
    pending = []
  }
  for (const item of items) {
    if (isWork(item)) {
      pending.push(item)
      continue
    }
    flush()
    switch (item.kind) {
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
      default:
        break
    }
  }
  flush()
  return rows
}

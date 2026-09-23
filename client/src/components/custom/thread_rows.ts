import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import type { ToolKind, WorkActivity } from './work_model'

type UserItem = Extract<ThreadItem, { kind: 'user_message' }>
type AssistantItem = Extract<ThreadItem, { kind: 'assistant_message' }>
type PlanItem = Extract<ThreadItem, { kind: 'plan' }>
type QuestionItem = Extract<ThreadItem, { kind: 'question' }>
type GalleryItem = Extract<ThreadItem, { kind: 'image_gallery' }>
type VideoItem = Extract<ThreadItem, { kind: 'video' }>
type WorkItem = Extract<ThreadItem, { kind: 'reasoning' | 'tool_call' | 'approval' }>

export type ThreadRow =
  | { kind: 'user'; id: string; item: UserItem }
  | { kind: 'assistant'; id: string; item: AssistantItem; streaming: boolean }
  | { kind: 'plan'; id: string; item: PlanItem; streaming: boolean }
  | { kind: 'work'; id: string; activities: WorkActivity[] }
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

function textRunning(
  item: { streaming?: boolean },
  isThreadTail: boolean,
  sessionRunning: boolean
) {
  return item.streaming ?? (isThreadTail && sessionRunning)
}

function toActivity(item: WorkItem, isThreadTail: boolean, sessionRunning: boolean): WorkActivity {
  if (item.kind === 'reasoning') {
    const running = textRunning(item, isThreadTail, sessionRunning)
    return {
      type: 'thinking',
      id: item.id,
      status: running ? 'running' : 'complete',
      summary: item.text,
      tokens: item.tokens,
      elapsedSeconds: running ? Math.max(0, (Date.now() - item.createdAt) / 1000) : undefined,
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
    target: toolTarget(item.toolName, item.input),
    status:
      item.status === 'failed' ? 'failed' : item.status === 'succeeded' ? 'complete' : 'running',
    input,
    output: item.output,
  }
}

function isWork(item: ThreadItem): item is WorkItem {
  return item.kind === 'reasoning' || item.kind === 'tool_call' || item.kind === 'approval'
}

export function threadRows(items: readonly ThreadItem[], status: SessionStatus): ThreadRow[] {
  const rows: ThreadRow[] = []
  const tailId = items.at(-1)?.id
  const sessionRunning = status === 'running' || status === 'starting'
  let pending: WorkItem[] = []
  function flush() {
    if (pending.length === 0) return
    rows.push({
      kind: 'work',
      id: pending[0]!.id,
      activities: pending.map((item) => toActivity(item, item.id === tailId, sessionRunning)),
    })
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
    }
  }
  flush()
  return rows
}

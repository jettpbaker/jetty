import type { SubagentStatus, ThreadItem } from '@jetty/shared/items'

import { formatDuration } from '@/lib/time'

import type { TodoUpdate } from './todo_model'

export type ActivityStatus =
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'waiting'
export type ToolKind = 'read' | 'edit' | 'write' | 'search' | 'terminal' | 'web' | 'generic'
export type ToolWords = {
  active: string
  done: string
  waiting?: string
  noun: string
  singular: string
}
export type ToolActivity = {
  type: 'tool'
  id: string
  kind: ToolKind
  name: string
  // A Jetty tool's own vocabulary; its target names threads or models, so it reads as prose.
  jettyTool?: string
  words?: ToolWords
  target: string
  files?: string[]
  fileChange?: { path: string; additions: number; deletions: number }
  description?: string
  status: ActivityStatus
  input?: string
  output?: string
}
export type ThinkingActivity = {
  type: 'thinking'
  id: string
  status: ActivityStatus
  summary: string
  tokens?: number
  elapsedSeconds?: number
}
export type TodoActivity = { type: 'todo'; id: string; update: TodoUpdate }
export type CreatedActivity = { type: 'created'; id: string; threadId: string; title?: string }
export type SubagentActivity = {
  type: 'subagent'
  id: string
  title: string
  status: SubagentStatus
  waiting: boolean
}
export type TextActivity = { type: 'text'; id: string; text: string; streaming: boolean }
export type QuestionActivity = {
  type: 'question'
  id: string
  item: Extract<ThreadItem, { kind: 'question' }>
  source?: string
}
export type ApprovalActivity = {
  type: 'approval'
  id: string
  item: Extract<ThreadItem, { kind: 'approval' }>
  source?: string
}
export type WorkActivity =
  | ToolActivity
  | ThinkingActivity
  | TodoActivity
  | CreatedActivity
  | SubagentActivity
  | TextActivity
  | QuestionActivity
  | ApprovalActivity
export type ToolBatch = { type: 'tools'; id: string; calls: ToolActivity[]; sealed: boolean }
export type ThreadBatch = { type: 'threads'; id: string; threads: CreatedActivity[] }
export type SubagentBatch = { type: 'subagents'; id: string; agents: SubagentActivity[] }
export type WorkEntry =
  | ToolBatch
  | ThreadBatch
  | SubagentBatch
  | ThinkingActivity
  | TodoActivity
  | TextActivity
  | QuestionActivity
  | ApprovalActivity

const vocabulary = {
  read: {
    active: 'Reading',
    done: 'Read',
    waiting: 'Waiting to read',
    noun: 'files',
    singular: 'file',
  },
  edit: {
    active: 'Editing',
    done: 'Edited',
    waiting: 'Waiting to edit',
    noun: 'files',
    singular: 'file',
  },
  write: {
    active: 'Writing',
    done: 'Wrote',
    waiting: 'Waiting to write',
    noun: 'files',
    singular: 'file',
  },
  search: {
    active: 'Searching',
    done: 'Searched',
    waiting: 'Waiting to search',
    noun: 'queries',
    singular: 'query',
  },
  terminal: {
    active: 'Running',
    done: 'Ran',
    waiting: 'Waiting to run',
    noun: 'commands',
    singular: 'command',
  },
  web: {
    active: 'Searching the web',
    done: 'Searched the web',
    waiting: 'Waiting to search the web',
    noun: 'queries',
    singular: 'query',
  },
  generic: {
    active: 'Calling',
    done: 'Called',
    waiting: 'Waiting to call',
    noun: 'calls',
    singular: 'call',
  },
} satisfies Record<ToolKind, ToolWords>

// A live block shows only its latest entries.
export const previewCount = 5

export function workEnded(status: ActivityStatus) {
  return ['complete', 'failed', 'cancelled', 'interrupted'].includes(status)
}

export function formatActivityDuration(seconds?: number) {
  return seconds === undefined ? undefined : formatDuration(Math.max(0, seconds))
}

export function groupWorkActivities(activities: readonly WorkActivity[], ended: boolean) {
  const entries: WorkEntry[] = []
  for (const activity of activities) {
    const previous = entries.at(-1)
    const head = previous?.type === 'tools' ? previous.calls[0]! : undefined
    if (activity.type === 'thinking' && previous?.type === 'thinking') {
      entries[entries.length - 1] = {
        ...activity,
        id: previous.id,
        summary: [previous.summary, activity.summary].filter(Boolean).join('\n\n'),
        tokens:
          previous.tokens === undefined && activity.tokens === undefined
            ? undefined
            : (previous.tokens ?? 0) + (activity.tokens ?? 0),
        elapsedSeconds:
          previous.elapsedSeconds === undefined && activity.elapsedSeconds === undefined
            ? undefined
            : (previous.elapsedSeconds ?? 0) + (activity.elapsedSeconds ?? 0),
      }
    } else if (
      activity.type === 'tool' &&
      previous?.type === 'tools' &&
      head?.kind === activity.kind &&
      (activity.kind !== 'generic' || head.name === activity.name)
    ) {
      previous.calls.push(activity)
    } else if (activity.type === 'created' && previous?.type === 'threads') {
      previous.threads.push(activity)
    } else if (activity.type === 'subagent' && previous?.type === 'subagents') {
      previous.agents.push(activity)
    } else {
      if (previous?.type === 'tools') previous.sealed = true
      entries.push(
        activity.type === 'tool'
          ? { type: 'tools', id: activity.id, calls: [activity], sealed: false }
          : activity.type === 'created'
            ? { type: 'threads', id: activity.id, threads: [activity] }
            : activity.type === 'subagent'
              ? { type: 'subagents', id: activity.id, agents: [activity] }
              : activity
      )
    }
  }
  const last = entries.at(-1)
  if (ended && last?.type === 'tools') last.sealed = true
  return entries
}

function sameActivity(a: WorkActivity, b: WorkActivity) {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, value]) => {
      if (key === 'files' && a.type === 'tool' && b.type === 'tool')
        return (
          a.files?.length === b.files?.length &&
          (a.files ?? []).every((file, index) => file === b.files?.[index])
        )
      return value === b[key as keyof WorkActivity]
    })
  )
}

// The rows hand over new activity objects on every change, so groups equal to the last call's keep
// their identity: a delta re-renders only the group it changed.
export function createWorkEntries() {
  let previous = new Map<string, WorkEntry>()
  return function group(activities: readonly WorkActivity[], ended: boolean) {
    const entries = groupWorkActivities(activities, ended).map((entry) => {
      const old = previous.get(entry.id)
      if (
        entry.type === 'tools' &&
        old?.type === 'tools' &&
        entry.sealed === old.sealed &&
        entry.calls.length === old.calls.length &&
        entry.calls.every((call, index) => sameActivity(call, old.calls[index]!))
      )
        return old
      if (
        entry.type === 'threads' &&
        old?.type === 'threads' &&
        entry.threads.length === old.threads.length &&
        entry.threads.every((thread, index) => sameActivity(thread, old.threads[index]!))
      )
        return old
      if (
        entry.type === 'subagents' &&
        old?.type === 'subagents' &&
        entry.agents.length === old.agents.length &&
        entry.agents.every((agent, index) => sameActivity(agent, old.agents[index]!))
      )
        return old
      return entry
    })
    previous = new Map(entries.map((entry) => [entry.id, entry]))
    return entries
  }
}

function countToolFiles(calls: ToolActivity[]) {
  return Math.max(1, new Set(calls.flatMap((call) => call.files ?? [call.target])).size)
}

function toolFailureVerb(call: ToolActivity) {
  switch (call.kind) {
    case 'read':
      return 'Failed to read'
    case 'edit':
      return 'Failed to edit'
    case 'write':
      return 'Failed to write'
    case 'search':
      return 'File search failed'
    case 'terminal':
      return 'Failed to run'
    case 'web':
      return 'Web search failed'
    case 'generic':
      return call.words ? `Failed while ${call.words.active.toLowerCase()}` : `${call.name} failed`
  }
}

export function describeToolBatch({ calls, sealed }: ToolBatch) {
  const first = calls[0]!
  const latest = calls.at(-1)!
  const count = (status: ActivityStatus) => calls.filter((call) => call.status === status).length
  const running = calls.filter((call) => call.status === 'running')
  // An approval holds the call: it hasn't started.
  const held = running.length > 0 ? [] : calls.filter((call) => call.status === 'waiting')
  const completed = count('complete')
  const failed = count('failed')
  const cancelled = count('cancelled')
  const interrupted = count('interrupted')
  const files = ['read', 'edit', 'write'].includes(first.kind)
  const counted = files || first.kind === 'terminal'
  const words = first.words ?? vocabulary[first.kind]
  const active =
    running.length > 0 ||
    held.length > 0 ||
    (counted && !sealed && failed + cancelled + interrupted === 0)
  const outcome = !active && !completed ? latest.status : undefined
  const itemCount = files
    ? countToolFiles(
        held.length > 0
          ? held
          : active
            ? calls
            : calls.filter((call) => call.status === (completed ? 'complete' : latest.status))
      )
    : first.kind === 'terminal'
      ? held.length || (active ? calls.length : completed || count(latest.status))
      : undefined
  const summarise =
    itemCount !== undefined || (sealed && calls.length > 1 && !active) || running.length > 1
  const shown = itemCount ?? (held.length || (active ? running.length : completed || calls.length))
  const current = running[0] ?? held[0] ?? latest
  let target = current.target
  if (first.kind === 'web') target = ''
  else if (summarise)
    target =
      first.kind === 'generic' && !first.words
        ? `${shown} ${first.name} call${shown === 1 ? '' : 's'}`
        : `${shown} ${shown === 1 ? words.singular : words.noun}`
  let verb =
    held.length > 0
      ? (first.words?.waiting ?? vocabulary[first.kind].waiting)
      : active
        ? words.active
        : words.done
  if (!active && failed + cancelled + interrupted > 0 && !(summarise && completed)) {
    if (latest.status === 'failed') {
      verb = toolFailureVerb(first)
      if (first.kind === 'search') target = ''
    } else if (latest.status === 'cancelled')
      verb = first.kind === 'web' ? 'Web search cancelled' : 'Cancelled'
    else if (latest.status === 'interrupted')
      verb = first.kind === 'web' ? 'Web search stopped' : 'Stopped'
  }
  const notices = (['failed', 'cancelled', 'interrupted'] as const)
    .filter((status) => calls.length > 1 && count(status) > 0 && !(counted && outcome === status))
    .map((status) => ({
      status,
      count: files ? countToolFiles(calls.filter((call) => call.status === status)) : count(status),
      text: status === 'interrupted' ? 'stopped' : status,
    }))
  const noticeText = notices.map((notice) => `${notice.count} ${notice.text}`).join(', ')
  return {
    verb,
    target,
    itemCount,
    countNoun: itemCount === 1 ? words.singular : words.noun,
    // A count ("2 files") is words. A single path or command stays machine text.
    prose: first.words !== undefined || summarise,
    active: active && held.length === 0,
    failed,
    notices,
    noticeText,
  }
}

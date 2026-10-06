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
export type ToolWords = { active: string; done: string; noun: string; singular: string }
export type ToolActivity = {
  type: 'tool'
  id: string
  kind: ToolKind
  name: string
  // A Jetty tool's own vocabulary; its target names threads or models, so it reads as prose.
  words?: ToolWords
  target: string
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
// what the agent said between its steps, as opposed to its answer after the last one
export type TextActivity = { type: 'text'; id: string; text: string }
export type TodoActivity = { type: 'todo'; id: string; update: TodoUpdate }
export type CreatedActivity = { type: 'created'; id: string; threadId: string; title?: string }
export type WorkActivity =
  | ToolActivity
  | ThinkingActivity
  | TextActivity
  | TodoActivity
  | CreatedActivity
export type ToolBatch = { type: 'tools'; id: string; calls: ToolActivity[]; sealed: boolean }
export type ThreadBatch = { type: 'threads'; id: string; threads: CreatedActivity[] }
export type WorkEntry = ToolBatch | ThreadBatch | ThinkingActivity | TextActivity | TodoActivity

const vocabulary = {
  read: {
    active: 'Reading',
    done: 'Read',
    noun: 'files',
    singular: 'file',
  },
  edit: {
    active: 'Editing',
    done: 'Edited',
    noun: 'files',
    singular: 'file',
  },
  write: {
    active: 'Writing',
    done: 'Wrote',
    noun: 'files',
    singular: 'file',
  },
  search: {
    active: 'Searching',
    done: 'Searched',
    noun: 'queries',
    singular: 'query',
  },
  terminal: {
    active: 'Running',
    done: 'Ran',
    noun: 'commands',
    singular: 'command',
  },
  web: {
    active: 'Searching the web',
    done: 'Searched the web',
    noun: 'queries',
    singular: 'query',
  },
  generic: {
    active: 'Calling',
    done: 'Called',
    noun: 'calls',
    singular: 'call',
  },
} satisfies Record<ToolKind, ToolWords>

// A live block shows only its latest entries.
export const previewCount = 3

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
    if (
      activity.type === 'tool' &&
      previous?.type === 'tools' &&
      head?.kind === activity.kind &&
      (activity.kind !== 'generic' || head.name === activity.name)
    ) {
      previous.calls.push(activity)
    } else if (activity.type === 'created' && previous?.type === 'threads') {
      previous.threads.push(activity)
    } else {
      if (previous?.type === 'tools') previous.sealed = true
      entries.push(
        activity.type === 'tool'
          ? { type: 'tools', id: activity.id, calls: [activity], sealed: false }
          : activity.type === 'created'
            ? { type: 'threads', id: activity.id, threads: [activity] }
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
    Object.entries(a).every(([key, value]) => value === b[key as keyof WorkActivity])
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
      return entry
    })
    previous = new Map(entries.map((entry) => [entry.id, entry]))
    return entries
  }
}

export function describeToolBatch({ calls, sealed }: ToolBatch) {
  const first = calls[0]!
  const latest = calls.at(-1)!
  const count = (status: ActivityStatus) => calls.filter((call) => call.status === status).length
  const running = calls.filter((call) => call.status === 'running')
  const completed = count('complete')
  const failed = count('failed')
  const cancelled = count('cancelled')
  const interrupted = count('interrupted')
  const words = first.words ?? vocabulary[first.kind]
  const active = running.length > 0
  const summarise = (sealed && calls.length > 1 && !active) || running.length > 1
  const shown = active ? running.length : completed || calls.length
  const current = running[0] ?? latest
  const description =
    first.kind === 'terminal' && !summarise ? current.description?.trim() || undefined : undefined
  const target = !summarise
    ? current.target
    : first.kind === 'generic' && !first.words
      ? `${shown} ${first.name} call${shown === 1 ? '' : 's'}`
      : `${shown} ${shown === 1 ? words.singular : words.noun}`
  let verb = active ? words.active : words.done
  if (!active && failed + cancelled + interrupted > 0 && !(summarise && completed)) {
    if (latest.status === 'failed') verb = 'Failed'
    else if (latest.status === 'cancelled') verb = 'Cancelled'
    else if (latest.status === 'interrupted') verb = 'Stopped'
  }
  const notices =
    calls.length === 1
      ? ''
      : [
          failed && `${failed} failed`,
          cancelled && `${cancelled} cancelled`,
          interrupted && `${interrupted} stopped`,
        ]
          .filter(Boolean)
          .join(', ')
  return {
    verb,
    description:
      description && (current.status === 'failed' || current.status === 'interrupted')
        ? `${current.status === 'failed' ? 'Failed' : 'Stopped'} ${description}`
        : description,
    target,
    // A count ("2 files") is words. A single path or command stays machine text.
    prose: first.words !== undefined || summarise,
    active,
    failed,
    notices,
  }
}

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
export type WorkActivity = ToolActivity | ThinkingActivity | TextActivity
export type ToolBatch = { type: 'tools'; id: string; calls: ToolActivity[]; sealed: boolean }
export type WorkEntry = ToolBatch | ThinkingActivity | TextActivity

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
  if (seconds === undefined) return undefined
  const value = Math.max(0, Math.floor(seconds))
  if (value < 60) return `${value}s`
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`
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
    } else {
      if (previous?.type === 'tools') previous.sealed = true
      entries.push(
        activity.type === 'tool'
          ? { type: 'tools', id: activity.id, calls: [activity], sealed: false }
          : activity
      )
    }
  }
  const last = entries.at(-1)
  if (ended && last?.type === 'tools') last.sealed = true
  return entries
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
    complete: completed === calls.length,
    active,
    failed,
    notices,
  }
}

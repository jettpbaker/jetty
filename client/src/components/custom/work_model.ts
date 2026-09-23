export type ActivityStatus =
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'waiting'
export type ToolKind = 'read' | 'edit' | 'write' | 'search' | 'terminal' | 'web' | 'generic'
export type ToolActivity = {
  type: 'tool'
  id: string
  kind: ToolKind
  name: string
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
export type WorkActivity = ToolActivity | ThinkingActivity
export type ToolBatch = { type: 'tools'; id: string; calls: ToolActivity[]; sealed: boolean }
export type WorkEntry = ToolBatch | ThinkingActivity

const vocabulary = {
  read: {
    active: 'Reading',
    done: 'Read',
    failed: 'Failed to read',
    noun: 'files',
    singular: 'file',
  },
  edit: {
    active: 'Editing',
    done: 'Edited',
    failed: 'Failed to edit',
    noun: 'files',
    singular: 'file',
  },
  write: {
    active: 'Writing',
    done: 'Wrote',
    failed: 'Failed to write',
    noun: 'files',
    singular: 'file',
  },
  search: {
    active: 'Searching',
    done: 'Searched',
    failed: 'Failed to search',
    noun: 'queries',
    singular: 'query',
  },
  terminal: {
    active: 'Running',
    done: 'Ran',
    failed: 'Failed to run',
    noun: 'commands',
    singular: 'command',
  },
  web: {
    active: 'Searching the web',
    done: 'Searched the web',
    failed: 'Failed to search for',
    noun: 'queries',
    singular: 'query',
  },
  generic: {
    active: 'Calling',
    done: 'Called',
    failed: 'Failed to call',
    noun: 'calls',
    singular: 'call',
  },
} satisfies Record<
  ToolKind,
  { active: string; done: string; failed: string; noun: string; singular: string }
>

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
        activity.type === 'thinking'
          ? activity
          : { type: 'tools', id: activity.id, calls: [activity], sealed: false }
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
  const waiting = count('waiting')
  const words = vocabulary[first.kind]
  const active = running.length > 0 && waiting === 0
  const summarise = (sealed && calls.length > 1 && !active && !waiting) || running.length > 1
  const shown = active ? running.length : completed || calls.length
  const current = calls.find((call) => call.status === 'waiting') ?? running[0] ?? latest
  const description =
    first.kind === 'terminal' && !summarise ? current.description?.trim() || undefined : undefined
  const target = !summarise
    ? current.target
    : first.kind === 'generic'
      ? `${shown} ${first.name} calls`
      : `${shown} ${shown === 1 ? words.singular : words.noun}`
  let verb = active ? words.active : words.done
  if (waiting) verb = 'Awaiting approval for'
  else if (!active && failed + cancelled + interrupted > 0 && !(summarise && completed)) {
    if (latest.status === 'failed') verb = words.failed
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
    description,
    target,
    complete: completed === calls.length,
    active,
    failed,
    waiting,
    notices,
  }
}

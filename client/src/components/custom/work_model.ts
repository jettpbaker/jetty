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
  name?: string
  target: string
  description?: string
  status: ActivityStatus
  elapsedSeconds?: number
  input?: string
  output?: string
  error?: string
}
export type ThinkingActivity = {
  type: 'thinking'
  id: string
  status: ActivityStatus
  summary?: string
  tokens?: number
  elapsedSeconds?: number
}
export type WorkActivity = ToolActivity | ThinkingActivity
export type ToolBatch = { type: 'tools'; id: string; calls: ToolActivity[]; sealed: boolean }
export type WorkEntry = ToolBatch | ThinkingActivity

const vocabulary = {
  read: { active: 'Reading', done: 'Read', noun: 'files', singular: 'file' },
  edit: { active: 'Editing', done: 'Edited', noun: 'files', singular: 'file' },
  write: { active: 'Writing', done: 'Wrote', noun: 'files', singular: 'file' },
  search: { active: 'Searching', done: 'Searched', noun: 'queries', singular: 'query' },
  terminal: { active: 'Running', done: 'Ran', noun: 'commands', singular: 'command' },
  web: {
    active: 'Searching the web',
    done: 'Searched the web',
    noun: 'queries',
    singular: 'query',
  },
  generic: { active: 'Calling', done: 'Called', noun: 'calls', singular: 'call' },
} satisfies Record<ToolKind, { active: string; done: string; noun: string; singular: string }>

export function formatActivityDuration(seconds?: number) {
  if (seconds === undefined) return undefined
  const value = Math.max(0, Math.floor(seconds))
  if (value < 60) return `${value}s`
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`
}

export function groupWorkActivities(
  activities: readonly WorkActivity[],
  ended = false
): WorkEntry[] {
  const entries: WorkEntry[] = []
  for (const activity of activities) {
    const previous = entries.at(-1)
    const head = previous?.type === 'tools' ? previous.calls[0] : undefined
    if (
      activity.type === 'tool' &&
      previous?.type === 'tools' &&
      head &&
      head.kind === activity.kind &&
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

export function describeToolBatch(batch: ToolBatch) {
  const first = batch.calls[0]
  const latest = batch.calls.at(-1)
  if (!first || !latest) {
    return {
      verb: '',
      target: '',
      description: undefined,
      complete: true,
      active: false,
      failed: 0,
      waiting: 0,
      notices: '',
      elapsed: undefined,
    }
  }
  const running = batch.calls.filter((call) => call.status === 'running')
  const failed = batch.calls.filter((call) => call.status === 'failed').length
  const waiting = batch.calls.filter((call) => call.status === 'waiting').length
  const cancelled = batch.calls.filter((call) => call.status === 'cancelled').length
  const interrupted = batch.calls.filter((call) => call.status === 'interrupted').length
  const words = vocabulary[first.kind]
  const active = running.length > 0 && waiting === 0
  const summarise =
    (batch.sealed && batch.calls.length > 1 && !active && !waiting) || running.length > 1
  const completed = batch.calls.filter((call) => call.status === 'complete').length
  const count = active ? running.length : completed || batch.calls.length
  const unsuccessful = failed + cancelled + interrupted > 0
  let verb = active ? words.active : words.done
  const current = batch.calls.find((call) => call.status === 'waiting') ?? running[0] ?? latest
  const description =
    first.kind === 'terminal' && !summarise ? current.description?.trim() || undefined : undefined
  let target = summarise ? `${count} ${count === 1 ? words.singular : words.noun}` : current.target
  if (first.kind === 'generic' && summarise) target = `${count} ${first.name ?? 'tool'} calls`
  if (waiting) verb = 'Awaiting approval for'
  else if (!active && unsuccessful && !(summarise && completed)) {
    const failedVerbs: Record<ToolKind, string> = {
      read: 'Failed to read',
      edit: 'Failed to edit',
      write: 'Failed to write',
      search: 'Failed to search',
      terminal: 'Failed to run',
      web: 'Failed to search for',
      generic: 'Failed to call',
    }
    verb =
      latest.status === 'failed'
        ? failedVerbs[first.kind]
        : latest.status === 'cancelled'
          ? 'Cancelled'
          : latest.status === 'interrupted'
            ? 'Interrupted'
            : words.done
  }
  const notices =
    batch.calls.length === 1
      ? ''
      : [
          failed && `${failed} failed`,
          cancelled && `${cancelled} cancelled`,
          interrupted && `${interrupted} interrupted`,
        ]
          .filter(Boolean)
          .join(', ')
  const elapsed =
    batch.calls.length === 1 ? formatActivityDuration(first.elapsedSeconds) : undefined
  return {
    verb,
    target,
    description,
    complete: batch.calls.every((call) => call.status === 'complete'),
    active,
    failed,
    waiting,
    notices,
    elapsed,
  }
}

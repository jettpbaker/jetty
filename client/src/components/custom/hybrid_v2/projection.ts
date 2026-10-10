import type { HybridLine, InterimText } from '@/lib/chat-feel'

import type { ThreadRow } from '../thread_rows'
import type { WorkEntry } from '../work_model'

import { describeToolBatch, groupWorkActivities, workEnded } from '../work_model'

export type TurnLabel = {
  verb: string
  target: string
  count?: number
  tense: 'present' | 'past'
  mono: boolean
  failed: boolean
  text: string
}
export type TurnRow = {
  id: string
  kind: 'activity' | 'text'
  label: TurnLabel
  live: boolean
  shimmer: boolean
  runningCalls: readonly string[]
  entry?: WorkEntry
  text?: string
  streaming?: boolean
  muted?: boolean
}
export type TurnAnswer = TurnRow & { kind: 'text'; text: string; streaming: boolean }
export type TurnView = {
  id: string
  turnId: string
  running: boolean
  heading: TurnLabel
  elapsedSeconds?: number
  rows: TurnRow[]
  cursor: string | null
  now: TurnLabel | null
  answer: TurnAnswer | null
  folded: boolean
}
export type TurnInput = {
  work: Extract<ThreadRow, { kind: 'work' }>
  answer?: Extract<ThreadRow, { kind: 'assistant' | 'plan' }>
  revealDone: boolean
  line?: HybridLine
  interim?: InterimText
  now?: number
}

function label(verb: string, target = '', present = false, mono = false): TurnLabel {
  return {
    verb,
    target,
    tense: present ? 'present' : 'past',
    mono,
    failed: false,
    text: `${verb} ${target}`.trim(),
  }
}

function activityRow(entry: WorkEntry, tail: boolean, running: boolean): TurnRow {
  const runningCalls =
    entry.type === 'tools'
      ? entry.calls.filter((call) => call.status === 'running').map((call) => call.id)
      : []
  let title: TurnLabel
  if (entry.type === 'tools') {
    const description = describeToolBatch(entry, running && tail, true)
    // Count labels describe the whole batch, including failures and parallel calls.
    const counted = entry.calls.length > 1
    const summary = counted
      ? describeToolBatch({ ...entry, sealed: false }, true, true)
      : description
    title = {
      verb: description.verb,
      target: summary.target,
      count: counted ? entry.calls.length : undefined,
      tense: description.active ? 'present' : 'past',
      mono: !summary.prose,
      failed: description.failed > 0,
      text: `${description.verb} ${summary.target}`.trim(),
    }
  } else if (entry.type === 'thinking') {
    title = label(
      running && tail && entry.status === 'running' ? 'Thinking' : 'Thought',
      '',
      running && tail && entry.status === 'running'
    )
  } else if (entry.type === 'threads') {
    title = label(
      'Created',
      `${entry.threads.length} thread${entry.threads.length === 1 ? '' : 's'}`
    )
  } else {
    title = label('Updated', 'task list')
  }
  return {
    id: entry.id,
    kind: 'activity',
    label: title,
    live: running && tail && title.tense === 'present',
    shimmer: false,
    runningCalls,
    entry,
  }
}

export function projectTurn({
  work,
  answer,
  revealDone,
  line = 'both',
  interim = 'b',
  now,
}: TurnInput): TurnView {
  const running = !workEnded(work.status)
  const rows: TurnRow[] = []
  const flow = work.flow ?? [work]
  for (const [index, part] of flow.entries()) {
    const tail = index === flow.length - 1
    if (part.kind === 'work') {
      const entries = groupWorkActivities(part.activities, !running || !tail)
      for (const [at, entry] of entries.entries())
        rows.push(activityRow(entry, tail && at === entries.length - 1, running))
    } else if (part.kind === 'assistant' || part.kind === 'plan') {
      rows.push({
        id: part.id,
        kind: 'text',
        label: label(''),
        live: running && tail,
        shimmer: false,
        runningCalls: [],
        text: part.item.text,
        streaming: part.streaming,
        muted: interim === 'a' || (interim === 'today' ? !tail : false),
      })
    }
  }
  const lastStep = rows.findLastIndex((row) => row.kind === 'activity')
  for (const [index, row] of rows.entries()) {
    if (row.kind === 'text' && interim === 'b') row.muted = index < lastStep
    row.shimmer =
      row.kind === 'activity' &&
      row.label.tense === 'present' &&
      ((row.entry?.type === 'tools' && !row.entry.sealed) || line === '2b' || line === 'both')
  }
  const tail = rows.at(-1)
  const cursor = tail?.live ? tail.id : null
  const hasLive = rows.some((row) => row.live || row.runningCalls.length > 0)
  const hideNow = tail?.kind === 'text' || (cursor !== null && (line === '2a' || line === 'both'))
  const nowLabel =
    !running || hideNow
      ? null
      : hasLive
        ? (rows.findLast((row) => row.label.tense === 'present')?.label ?? null)
        : label('Planning next moves', '', true)
  return {
    id: work.id,
    turnId: work.turnId,
    running,
    heading: label(running ? 'Working' : 'Worked', '', running),
    elapsedSeconds:
      work.elapsedSeconds ??
      (now !== undefined && work.startedAt !== undefined
        ? Math.max(0, (now - work.startedAt) / 1000)
        : undefined),
    rows,
    cursor: cursor ?? (nowLabel ? `${work.id}:now` : null),
    now: nowLabel,
    answer: answer
      ? {
          id: answer.id,
          kind: 'text',
          label: label(''),
          live: false,
          shimmer: false,
          runningCalls: [],
          text: answer.item.text,
          streaming: answer.streaming,
          muted: false,
        }
      : null,
    folded: !running && !!answer && revealDone,
  }
}

import type { HybridLine, InterimText } from '@/lib/chat-feel'
import type { ThreadItem } from '@jetty/shared/items'

import { awaitsInput } from '@jetty/shared/items'

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
  kind: 'activity' | 'text' | 'marker'
  label: TurnLabel
  live: boolean
  shimmer: boolean
  runningCalls: readonly string[]
  item?: Extract<ThreadItem, { kind: 'approval' | 'question' }>
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
  items?: readonly ThreadItem[]
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

function activityRow(entry: WorkEntry, tail: boolean, running: boolean, now?: number): TurnRow {
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
      mono: (counted || !description.description) && !summary.prose,
      failed: description.failed > 0,
      text: (!counted && description.description) || `${description.verb} ${summary.target}`.trim(),
    }
  } else if (entry.type === 'thinking') {
    const active = running && tail && entry.status === 'running'
    const tokens = entry.tokens !== undefined && entry.tokens > 0 ? entry.tokens : undefined
    const end = entry.endedAt ?? (active ? now : undefined)
    const seconds = Math.floor(
      Math.max(
        0,
        entry.startedAt !== undefined && end !== undefined
          ? (end - entry.startedAt) / 1000
          : (entry.elapsedSeconds ?? 0)
      )
    )
    const count = tokens ?? (seconds >= 1 ? seconds : undefined)
    title = {
      ...label(
        active ? 'Thinking' : 'Thought',
        tokens !== undefined
          ? `for ${tokens} token${tokens === 1 ? '' : 's'}`
          : seconds >= 1
            ? `for ${seconds}s`
            : '',
        active
      ),
      count,
    }
  } else if (entry.type === 'threads') {
    title = {
      ...label('Created', `${entry.threads.length} thread${entry.threads.length === 1 ? '' : 's'}`),
      count: entry.threads.length,
    }
  } else {
    title = label('Updated', 'task list')
  }
  return {
    id: entry.id,
    kind: 'activity',
    label: title,
    live: running && (tail || runningCalls.length > 0) && title.tense === 'present',
    shimmer: false,
    runningCalls,
    entry,
  }
}

export function projectTurn({
  work,
  answer,
  items = [],
  revealDone,
  line = 'both',
  interim = 'b',
  now,
}: TurnInput): TurnView {
  const running = !workEnded(work.status)
  const requests = items.filter(
    (item): item is Extract<ThreadItem, { kind: 'approval' | 'question' }> =>
      item.turnId === work.turnId &&
      !item.agentId &&
      (item.kind === 'approval' || item.kind === 'question')
  )
  const pending = running ? requests.findLast(awaitsInput) : undefined
  const waiting = running && (pending !== undefined || work.status === 'waiting')
  const rows: TurnRow[] = []
  const flow = work.flow ?? [work]
  for (const [index, part] of flow.entries()) {
    const tail = index === flow.length - 1
    if (part.kind === 'work') {
      const entries = groupWorkActivities(part.activities, !running || !tail)
      for (const [at, entry] of entries.entries())
        rows.push(activityRow(entry, tail && at === entries.length - 1, running, now))
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
    if (waiting) row.live = false
    row.shimmer =
      !waiting &&
      row.kind === 'activity' &&
      row.label.tense === 'present' &&
      (row.runningCalls.length > 0 ||
        (row.entry?.type === 'tools' && !row.entry.sealed) ||
        line === '2b' ||
        line === 'both')
  }
  const tail = rows.at(-1)
  const cursor = tail?.live ? tail.id : null
  const hasLive = rows.some((row) => row.live || row.runningCalls.length > 0)
  const hideNow = tail?.kind === 'text' || (cursor !== null && (line === '2a' || line === 'both'))
  const nowLabel = waiting
    ? label('Waiting for', pending?.kind === 'question' ? 'your answer' : 'approval', true)
    : !running || hideNow
      ? null
      : hasLive
        ? (rows.findLast((row) => row.label.tense === 'present')?.label ?? null)
        : label('Planning next moves', '', true)
  for (const item of requests) {
    if (awaitsInput(item)) continue
    const next = rows.findIndex(
      (row) => items.findIndex((candidate) => candidate.id === row.id) > items.indexOf(item)
    )
    rows.splice(next < 0 ? rows.length : next, 0, {
      id: item.id,
      kind: 'marker',
      item,
      label: label(''),
      live: false,
      shimmer: false,
      runningCalls: [],
    })
  }
  return {
    id: work.id,
    turnId: work.turnId,
    running,
    heading: label(waiting ? 'Waiting for you' : running ? 'Working' : 'Worked', '', running),
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

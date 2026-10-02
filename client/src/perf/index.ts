import type { ThreadUpdate } from '@jetty/shared/rpc'

import { budgets } from './budgets'
import { epoch, push, recent, sid } from './ring'

export type JourneyName =
  | 'app.launch'
  | 'thread.switch'
  | 'thread.open'
  | 'turn.send'
  | 'turn.stream'
  | 'pr.open'
  | 'pr.diff'
  | 'composer.key'

type Phase = 'input' | 'local' | 'rendered' | 'painted' | 'caughtUp'
type Ids = Record<string, string | number | boolean>
type LoafScript = { url: string; pos: number; fn: string }

export type LongAnimationFrame = PerformanceEntry & {
  blockingDuration: number
  scripts: { sourceURL: string; sourceCharPosition: number; sourceFunctionName: string }[]
}

export type Counters = {
  commits: number
  loafCount: number
  loafBlockingMs: number
  shifts: number
  wsMsgs: number
  wsBytes: number
}

type Journey = {
  jid: string
  name: JourneyName
  ids: Ids
  start: number
  phases: Partial<Record<Phase, number>>
  base: Counters
  awaitCaughtUp: boolean
  deltas: number
}

const counters: Counters = {
  commits: 0,
  loafCount: 0,
  loafBlockingMs: 0,
  shifts: 0,
  wsMsgs: 0,
  wsBytes: 0,
}

let enabled = false
let nextId = 0
// One open journey per slot: a new thread click supersedes the last one, turns are per thread.
const open = new Map<string, Journey>()
let awaitingCommit: Journey[] = []
const replies = new Map<string, string>()
const loafs: { start: number; end: number; scripts: LoafScript[] }[] = []
// One snapshot per journey name per gap, so a janky stretch can't flood the ring.
const lastSnapshot = new Map<JourneyName, number>()
const snapshotGapMs = 30_000

const round = (ms: number) => Math.round(ms * 10) / 10

function slot(name: JourneyName, ids: Ids) {
  if (name.startsWith('thread.')) return 'thread'
  return name.startsWith('turn.') ? `${name}:${ids.threadId}` : name
}

let drain = () => {}

// Observers deliver late; `drain` pulls their queued entries so counters are current.
export function enable(drainObservers: () => void) {
  enabled = true
  drain = drainObservers
}

export function settledCounters(): Counters {
  drain()
  return { ...counters }
}

export function startAt(
  name: JourneyName,
  ids: Ids,
  at: number,
  awaitCaughtUp = false
): string | undefined {
  if (!enabled) return undefined
  const jid = `${sid}.${++nextId}`
  open.set(slot(name, ids), {
    jid,
    name,
    ids,
    start: at,
    phases: { input: 0 },
    base: { ...counters },
    awaitCaughtUp,
    deltas: 0,
  })
  return jid
}

function find(jid: string | undefined) {
  if (!jid) return undefined
  for (const journey of open.values()) if (journey.jid === jid) return journey
}

function markJourney(journey: Journey, phase: Phase) {
  if (journey.phases[phase] !== undefined) return
  journey.phases[phase] = round(performance.now() - journey.start)
  if (phase === 'rendered')
    requestAnimationFrame(() => setTimeout(() => markJourney(journey, 'painted'), 0))
  const { painted, caughtUp } = journey.phases
  if (painted !== undefined && (!journey.awaitCaughtUp || caughtUp !== undefined)) finish(journey)
}

function finish(journey: Journey) {
  if (open.get(slot(journey.name, journey.ids)) !== journey) return
  open.delete(slot(journey.name, journey.ids))
  const d = journey.phases.painted ?? round(performance.now() - journey.start)
  emit(journey, d, settledCounters())
}

function emit(journey: Journey, d: number, now: Counters) {
  const budgetMs = budgets[journey.name]
  const over = d > budgetMs
  push({
    v: 1,
    t: epoch(journey.start),
    sid,
    k: 'journey',
    n: journey.name,
    d,
    jid: journey.jid,
    a: {
      ...journey.ids,
      ...journey.phases,
      commits: now.commits - journey.base.commits,
      loafCount: now.loafCount - journey.base.loafCount,
      loafBlockingMs: now.loafBlockingMs - journey.base.loafBlockingMs,
      shifts: now.shifts - journey.base.shifts,
      wsMsgs: now.wsMsgs - journey.base.wsMsgs,
      wsBytes: now.wsBytes - journey.base.wsBytes,
      ...(journey.name === 'turn.stream' ? { deltas: journey.deltas } : {}),
      budgetMs,
      over,
    },
  })
  try {
    performance.measure(journey.name, {
      start: journey.start,
      end: journey.start + d,
      detail: { devtools: { dataType: 'track-entry', track: 'Jetty' } },
    })
    performance.clearMeasures(journey.name)
  } catch {}
  if (over) snapshot(journey, journey.start + d)
}

function snapshot(journey: Journey, end: number) {
  const now = performance.now()
  if (now - (lastSnapshot.get(journey.name) ?? -Infinity) < snapshotGapMs) return
  lastSnapshot.set(journey.name, now)
  const scripts: LoafScript[] = []
  for (const loaf of loafs)
    if (loaf.end >= journey.start && loaf.start <= end) scripts.push(...loaf.scripts)
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  push({
    v: 1,
    t: epoch(),
    sid,
    k: 'snapshot',
    n: journey.name,
    jid: journey.jid,
    a: {
      domNodes: document.getElementsByTagName('*').length,
      ...(memory ? { heapBytes: memory.usedJSHeapSize } : {}),
      scripts: JSON.stringify(scripts),
      recent: JSON.stringify(recent(200).filter((record) => record.k !== 'snapshot')),
    },
  })
}

export function sweep() {
  const now = performance.now()
  for (const journey of open.values()) {
    const painted = journey.phases.painted
    if (painted !== undefined && now - journey.start - painted > 10_000) finish(journey)
    else if (now - journey.start > 120_000) open.delete(slot(journey.name, journey.ids))
  }
}

export function onCommit() {
  counters.commits++
  if (awaitingCommit.length === 0) return
  const due = awaitingCommit
  awaitingCommit = []
  for (const journey of due) markJourney(journey, 'rendered')
}

export function recordLoaf(entry: LongAnimationFrame) {
  const blocking = Math.round(entry.blockingDuration)
  counters.loafCount++
  counters.loafBlockingMs += blocking
  const scripts = entry.scripts.map((script) => ({
    url: script.sourceURL,
    pos: script.sourceCharPosition,
    fn: script.sourceFunctionName,
  }))
  loafs.push({ start: entry.startTime, end: entry.startTime + entry.duration, scripts })
  if (loafs.length > 50) loafs.shift()
  push({
    v: 1,
    t: epoch(entry.startTime),
    sid,
    k: 'loaf',
    n: 'loaf',
    d: round(entry.duration),
    a: { blockingMs: blocking, scripts: scripts.length },
  })
}

export function recordShift(value: number, region: string, at: number) {
  counters.shifts++
  push({ v: 1, t: epoch(at), sid, k: 'shift', n: region, a: { value: round(value * 1000) / 1000 } })
}

export function recordEvent(
  entry: PerformanceEventTiming,
  region: string,
  key?: { base: Counters; end?: Counters }
) {
  push({
    v: 1,
    t: epoch(entry.startTime),
    sid,
    k: 'event',
    n: entry.name,
    d: entry.duration,
    a: {
      interactionId: entry.interactionId,
      inputDelay: round(entry.processingStart - entry.startTime),
      processingMs: round(entry.processingEnd - entry.processingStart),
      region,
    },
  })
  if (!key) return
  const journey: Journey = {
    jid: `${sid}.${++nextId}`,
    name: 'composer.key',
    ids: {},
    start: entry.startTime,
    phases: {
      input: 0,
      rendered: round(entry.processingEnd - entry.startTime),
      painted: entry.duration,
    },
    base: key.base,
    awaitCaughtUp: false,
    deltas: 0,
  }
  emit(journey, entry.duration, key.end ?? settledCounters())
}

function threadMark(threadId: string, phase: Phase) {
  const journey = open.get('thread')
  if (journey?.ids.threadId === threadId) markJourney(journey, phase)
}

function socketMessage(event: MessageEvent) {
  const data: unknown = event.data
  counters.wsMsgs++
  counters.wsBytes +=
    typeof data === 'string'
      ? data.length
      : data instanceof Blob
        ? data.size
        : (data as ArrayBuffer).byteLength
}

export const perf = {
  start(name: JourneyName, ids: Ids = {}) {
    return startAt(name, ids, performance.now())
  },
  mark(jid: string | undefined, phase: Phase) {
    const journey = find(jid)
    if (journey) markJourney(journey, phase)
  },
  end(jid: string | undefined) {
    const journey = find(jid)
    if (journey) finish(journey)
  },
  // Marks `rendered` on the open journey with this name whose ids include `match`.
  rendered(name: JourneyName, match: Ids = {}) {
    if (!enabled) return
    for (const journey of open.values())
      if (journey.name === name && Object.entries(match).every(([k, v]) => journey.ids[k] === v))
        markJourney(journey, 'rendered')
  },
  threadClick(threadId: string, cached: boolean, live: boolean) {
    startAt(cached ? 'thread.switch' : 'thread.open', { threadId }, performance.now(), !live)
  },
  threadLocal(threadId: string, shown: boolean) {
    if (enabled && shown && open.get('thread')?.name === 'thread.switch')
      threadMark(threadId, 'local')
  },
  threadShown(threadId: string, shown: boolean) {
    if (enabled && shown) threadMark(threadId, 'rendered')
  },
  threadUpdate(threadId: string, update: ThreadUpdate) {
    if (!enabled) return
    if (update.type !== 'event') return threadMark(threadId, 'caughtUp')
    const event = update.event
    if (event.type === 'item.started') {
      // Replayed history arrives with old timestamps; only a live reply opens a stream.
      if (event.item.kind === 'assistant_message' && Date.now() - update.ts < 10_000)
        replies.set(threadId, event.item.id)
      return
    }
    if (event.type === 'item.delta') {
      const key = `turn.stream:${threadId}`
      if (!open.has(key) && replies.get(threadId) === event.itemId) {
        const send = open.get(`turn.send:${threadId}`)
        if (send) awaitingCommit.push(send)
        startAt('turn.stream', { threadId }, performance.now())
      }
      const stream = open.get(key)
      if (stream) stream.deltas++
      return
    }
    if (event.type !== 'turn.completed' && event.type !== 'turn.failed') return
    replies.delete(threadId)
    const stream = open.get(`turn.stream:${threadId}`)
    if (stream) awaitingCommit.push(stream)
  },
  watchSocket(socket: WebSocket) {
    if (enabled) socket.addEventListener('message', socketMessage)
    return socket
  },
}

import type { ThreadItem } from '@jetty/shared/items'

import { shownInBotChat } from '@jetty/shared/bots'

import type { BotRow, EventRow, ThreadRow, TranscriptEntry, TranscriptLine } from './wire'

import { formatDuration } from './format'

// The lanes, top to bottom. Colours are bot colour names (var(--bot-<name>)); the bot lane takes
// the bot's own name and colour. Where each record lands is decided below, marked "→ lane".

const LANES = [
  { id: 'jett', label: 'Jett', color: 'orange' },
  { id: 'wakes', label: 'Wakes', color: 'teal' },
  { id: 'bot', label: 'Bot', color: 'lilac' },
  { id: 'harness', label: 'Harness', color: 'butter' },
  { id: 'tools', label: 'Tools', color: 'mint' },
] as const
const WORKER_COLOR = 'blue'
const SPARE_COLORS = ['rose', 'coral', 'slate']

// Bot tools that are the bot speaking, drawn inside its turn instead of in Tools.
const SPEECH_TOOLS: Record<string, SpanKind> = { say: 'tell', tell_user: 'tell', react: 'react' }

// Attachments that recur after every tool result; drawn as ticks, hidden from the log by default.
const QUIET_ATTACHMENTS = new Set(['total_tokens_reminder'])
// Attachments that steer the model rather than inform it.
const LOUD_ATTACHMENTS = new Set([
  'silent_turn_reminder',
  'batching_reminder_sent',
  'hook_stopped_continuation',
  'hook_additional_context',
  'hook_blocking_error',
])
// Attachments without rendered text that the model still sees.
const UNRENDERED_SEEN = new Set(['prompt_snapshot'])

// A queue entry dequeued within this was plumbing for a message, not steering.
const STEER_MS = 1000
// How far apart a transcript entry and the Jetty record it mirrors can be.
const MATCH_MS = 3000

export type LaneId = string

export type Lane = { id: LaneId; label: string; color: string; worker: boolean; rows: number }

export type SpanKind =
  | 'message'
  | 'wake'
  | 'turn'
  | 'thinking'
  | 'bubble'
  | 'note'
  | 'tell'
  | 'react'
  | 'ask'
  | 'error'
  | 'harness'
  | 'tool'
  | 'approval'
  | 'worker-turn'
  | 'marker'

export type Raw = ({ kind: 'event' } & EventRow) | ({ kind: 'transcript' } & TranscriptLine)

export type Span = {
  id: string
  lane: LaneId
  kind: SpanKind
  start: number
  // null while it runs; equal to start for an instant
  end: number | null
  instant: boolean
  row: number
  parent?: string
  label: string
  actor: string
  tag?: string
  text: string
  detail?: string
  failed?: boolean
  quiet?: boolean
  loud?: boolean
  private?: boolean
  // a private turn that Jett's message turned visible
  visibleFrom?: number
  raw: Raw[]
  links: string[]
}

export type Link = { from: string; to: string; at: number }

export type Sources = {
  bot: BotRow
  threads: Map<string, ThreadRow>
  events: EventRow[]
  transcript: TranscriptLine[]
}

export type Timeline = {
  lanes: Lane[]
  spans: Span[]
  byId: Map<string, Span>
  links: Link[]
  activity: number[]
  runningTurn: Span | null
  model: string
  workerModels: string[]
  unmapped: Map<string, number>
}

type ItemFold = { item: ThreadItem; raw: Raw[]; completedAt?: number }
type TurnFold = {
  id: string
  start: number
  end?: number
  outcome?: 'completed' | 'failed' | 'interrupted' | 'server restarted'
  error?: string
  outputTokens?: number
  model?: string
  effort?: string
  raw: Raw[]
}

function foldThread(rows: EventRow[], unmapped: Map<string, number>) {
  const items = new Map<string, ItemFold>()
  const turns = new Map<string, TurnFold>()
  const turnFor = (id: string, ts: number) => {
    const turn = turns.get(id) ?? { id, start: ts, raw: [] }
    turns.set(id, turn)
    return turn
  }
  for (const row of rows) {
    const raw: Raw = { kind: 'event', ...row }
    const event = row.event
    switch (event.type) {
      case 'turn.started': {
        const turn = turnFor(event.turnId, row.ts)
        turn.start = row.ts
        turn.model = event.loadout?.model
        turn.effort = event.loadout?.effort
        turn.raw.push(raw)
        break
      }
      case 'turn.completed':
      case 'turn.failed': {
        const turn = turnFor(event.turnId, row.ts)
        turn.end = row.ts
        turn.raw.push(raw)
        if (event.type === 'turn.completed') {
          turn.outcome = 'completed'
          turn.outputTokens = event.usage?.outputTokens
        } else {
          turn.outcome =
            event.error === 'interrupted'
              ? 'interrupted'
              : event.error === 'server_restarted'
                ? 'server restarted'
                : 'failed'
          turn.error = event.error
        }
        // A turn's end settles what it left open, as the reducer does; background agents go on.
        for (const fold of items.values()) {
          const item = fold.item
          const background =
            (item.kind === 'subagent' || item.kind === 'workflow') && item.status === 'running'
          if (item.turnId === event.turnId && fold.completedAt == null && !background)
            fold.completedAt = row.ts
        }
        break
      }
      case 'item.started':
        items.set(event.item.id, { item: { ...event.item }, raw: [raw] })
        break
      case 'item.delta': {
        const fold = items.get(event.itemId)
        if (!fold) break
        fold.raw.push(raw)
        const item = fold.item
        if (item.kind === 'reasoning')
          fold.item = { ...item, tokens: (item.tokens ?? 0) + (event.tokens ?? 0) }
        if (item.kind === 'assistant_message' || item.kind === 'plan' || item.kind === 'reasoning')
          fold.item = { ...fold.item, text: item.text + event.delta } as ThreadItem
        if (item.kind === 'tool_call') fold.item = { ...item, output: item.output + event.delta }
        break
      }
      case 'item.updated':
      case 'item.completed': {
        const fold = items.get(event.itemId)
        if (!fold) break
        fold.raw.push(raw)
        fold.item = { ...fold.item, ...event.patch } as ThreadItem
        if (event.type === 'item.completed') fold.completedAt = row.ts
        break
      }
      default:
        count(unmapped, `event ${event.type}`)
    }
  }
  return { items: [...items.values()], turns: [...turns.values()] }
}

function count(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

// One line for a label: links read as their text.
function oneLine(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([a-z]+:[^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortTool(name: string) {
  return name.startsWith('mcp__') ? name.split('__').slice(2).join('__') : name
}

function toolSummary(input: unknown) {
  if (!input || typeof input !== 'object') return ''
  const fields = input as Record<string, unknown>
  for (const key of ['description', 'title', 'command', 'file_path', 'pattern', 'query', 'url']) {
    const value = fields[key]
    if (typeof value === 'string' && value) return oneLine(value)
  }
  const first = Object.values(fields).find((value) => typeof value === 'string')
  return typeof first === 'string' ? oneLine(first) : ''
}

export function buildTimeline(sources: Sources): Timeline {
  const { bot } = sources
  const unmapped = new Map<string, number>()
  const spans: Span[] = []
  const links: Link[] = []
  const byId = new Map<string, Span>()
  const add = (span: Omit<Span, 'row' | 'links'> & { links?: string[] }) => {
    const full: Span = { row: 0, ...span, links: span.links ?? [] }
    spans.push(full)
    byId.set(full.id, full)
    return full
  }
  const link = (from: Span, to: Span, at: number) => {
    links.push({ from: from.id, to: to.id, at })
    from.links.push(to.id)
    to.links.push(from.id)
  }

  const eventsByThread = new Map<string, EventRow[]>()
  for (const row of sources.events) {
    const rows = eventsByThread.get(row.threadId) ?? []
    rows.push(row)
    eventsByThread.set(row.threadId, rows)
  }
  for (const rows of eventsByThread.values()) rows.sort((a, b) => a.seq - b.seq)

  const workers = [...sources.threads.values()].filter((thread) => thread.id !== bot.id)
  const workerIds = new Set(workers.map((worker) => worker.id))

  // → worker lanes: one per child thread, its turns as spans.
  const workerTurns = new Map<string, Span[]>()
  for (const worker of workers) {
    const { items, turns } = foldThread(eventsByThread.get(worker.id) ?? [], unmapped)
    const spansOfWorker: Span[] = []
    for (const turn of turns) {
      const opener = items.find(
        (fold) => fold.item.kind === 'user_message' && fold.item.turnId === turn.id
      )
      const prompt = opener?.item.kind === 'user_message' ? opener.item.text : ''
      spansOfWorker.push(
        add({
          id: `turn:${turn.id}`,
          lane: `worker:${worker.id}`,
          kind: 'worker-turn',
          start: turn.start,
          end: turn.end ?? null,
          instant: false,
          label: oneLine(prompt) || 'turn',
          actor: worker.title,
          tag: turn.outcome === 'completed' || !turn.outcome ? 'turn' : turn.outcome,
          text: oneLine(prompt) || 'turn',
          detail: prompt || undefined,
          failed: turn.outcome === 'failed' || turn.outcome === 'server restarted',
          raw: [...(opener?.raw ?? []), ...turn.raw],
        })
      )
    }
    workerTurns.set(worker.id, spansOfWorker)
  }

  // The bot's own thread.
  const { items, turns } = foldThread(eventsByThread.get(bot.id) ?? [], unmapped)
  const turnSpans = new Map<string, Span>()
  let model = bot.model
  let effort = bot.effort ?? ''
  for (const turn of turns) {
    const inTurn = items.filter((fold) => fold.item.turnId === turn.id)
    const messages = inTurn.flatMap((fold) =>
      fold.item.kind === 'user_message' ? [fold.item] : []
    )
    const opener = messages[0]
    const isPrivate = !opener || !!opener.from
    const turnedVisible = isPrivate ? messages.find((message) => !message.from) : undefined
    if (turn.model) model = turn.model
    if (turn.effort) effort = turn.effort
    const duration = turn.end ? formatDuration(turn.end - turn.start) : 'running'
    const outcome = turn.outcome === 'failed' ? `failed: ${turn.error}` : (turn.outcome ?? '')
    // → bot lane: one span per turn.
    turnSpans.set(
      turn.id,
      add({
        id: `turn:${turn.id}`,
        lane: 'bot',
        kind: 'turn',
        start: turn.start,
        end: turn.end ?? null,
        instant: false,
        label: isPrivate ? 'private turn' : 'turn',
        actor: bot.name,
        tag: isPrivate ? (turnedVisible ? 'private → visible' : 'private') : 'visible',
        text: [
          `${isPrivate ? 'Private' : 'Visible'} turn`,
          outcome,
          duration,
          turn.outputTokens != null ? `${turn.outputTokens} tokens out` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        detail: turn.error,
        failed: turn.outcome === 'failed' || turn.outcome === 'server restarted',
        private: isPrivate,
        visibleFrom: turnedVisible?.createdAt,
        raw: turn.raw,
      })
    )
  }

  // tell_user writes its bubble as an assistant message; it joins the tell_user mark.
  const told = new Set<string>()
  const toldBy = new Map<string, ItemFold>()
  for (const fold of items) {
    const item = fold.item
    if (item.kind !== 'tool_call' || SPEECH_TOOLS[shortTool(item.toolName)] !== 'tell') continue
    const input = item.input as { text?: unknown } | null
    const bubble = items.find(
      (other) =>
        other.item.kind === 'assistant_message' &&
        !told.has(other.item.id) &&
        other.item.text === input?.text &&
        Math.abs(other.item.createdAt - item.createdAt) < MATCH_MS
    )
    if (!bubble) continue
    told.add(bubble.item.id)
    toldBy.set(item.id, bubble)
  }

  const messageSpans: Span[] = []
  for (const fold of items) {
    const item = fold.item
    const turn = turnSpans.get(item.turnId)
    const end = fold.completedAt ?? item.completedAt ?? null
    const base = {
      id: `item:${item.id}`,
      start: item.createdAt,
      raw: fold.raw,
    }
    const inTurn = {
      ...base,
      lane: 'bot',
      parent: turn?.id,
      actor: bot.name,
    }
    if (item.agentId) {
      // → tools: anything a subagent did happens inside its tool call.
      add({
        ...base,
        lane: 'tools',
        kind: 'tool',
        end,
        instant: false,
        label: item.kind === 'tool_call' ? `↳ ${shortTool(item.toolName)}` : `↳ ${item.kind}`,
        actor: 'Subagent',
        tag: item.kind === 'tool_call' ? shortTool(item.toolName) : item.kind,
        text: item.kind === 'tool_call' ? toolSummary(item.input) : item.kind,
        quiet: true,
        failed: item.kind === 'tool_call' && item.status === 'failed',
      })
      continue
    }
    switch (item.kind) {
      case 'user_message': {
        const steer = !!turn && item.createdAt > turn.start + 50
        const detail = [...(item.replies ?? []).map((reply) => `> ${reply.text}`), item.text]
          .filter(Boolean)
          .join('\n\n')
        const span = item.from
          ? // → wakes: anything else that starts or steers a bot turn.
            add({
              ...base,
              lane: 'wakes',
              kind: 'wake',
              end: item.createdAt,
              instant: true,
              label: oneLine(item.text).startsWith(item.from.title)
                ? oneLine(item.text)
                : `${item.from.title} · ${oneLine(item.text)}`,
              actor: item.from.title,
              tag: item.reports?.length
                ? `report · ${item.reports.map((report) => report.outcome).join(', ')}`
                : workerIds.has(item.from.threadId)
                  ? 'worker'
                  : steer
                    ? 'steer'
                    : 'wake',
              text: oneLine(item.text),
              detail,
            })
          : // → jett: his own messages.
            add({
              ...base,
              lane: 'jett',
              kind: 'message',
              end: item.createdAt,
              instant: true,
              label: oneLine(item.text),
              actor: 'Jett',
              tag: steer ? 'steer' : item.replies ? 'reply' : undefined,
              text: oneLine(item.text),
              detail: item.replies ? detail : undefined,
            })
        messageSpans.push(span)
        if (turn) link(span, turn, steer ? item.createdAt : turn.start)
        if (item.from && workerIds.has(item.from.threadId)) {
          const reported = (workerTurns.get(item.from.threadId) ?? []).findLast(
            (workerTurn) => workerTurn.end != null && workerTurn.end <= item.createdAt + MATCH_MS
          )
          if (reported) link(reported, span, item.createdAt)
        }
        break
      }
      case 'assistant_message': {
        if (told.has(item.id)) break
        const shown = shownInBotChat(item)
        add({
          ...inTurn,
          kind: shown ? 'bubble' : 'note',
          end,
          instant: false,
          label: oneLine(item.text) || '(empty)',
          tag: shown ? 'bubble' : 'private note',
          text: oneLine(item.text) || '(empty)',
          detail: item.text || undefined,
        })
        break
      }
      case 'reasoning': {
        const tokens = item.tokens ? `~${item.tokens} tokens` : ''
        add({
          ...inTurn,
          kind: 'thinking',
          end,
          instant: false,
          label: 'thinking',
          tag: 'thinking',
          text: [end ? formatDuration(end - item.createdAt) : 'running', tokens]
            .filter(Boolean)
            .join(' · '),
          detail: item.text || undefined,
        })
        break
      }
      case 'tool_call': {
        const name = shortTool(item.toolName)
        const speech = SPEECH_TOOLS[name]
        if (speech) {
          const input = item.input as { text?: unknown; emoji?: unknown } | null
          const said = String((speech === 'react' ? input?.emoji : input?.text) ?? '')
          add({
            ...inTurn,
            raw: [...fold.raw, ...(toldBy.get(item.id)?.raw ?? [])],
            kind: speech,
            end: item.createdAt,
            instant: true,
            label: speech === 'tell' ? `↗ ${oneLine(said)}` : said,
            tag: name,
            text: oneLine(said),
            detail: speech === 'tell' ? said : item.output || undefined,
            failed: item.status === 'failed',
          })
          break
        }
        const summary = toolSummary(item.input)
        // → tools: every other tool call, call → result.
        add({
          ...base,
          lane: 'tools',
          kind: 'tool',
          end,
          instant: false,
          label: summary ? `${name} · ${summary}` : name,
          actor: 'Tool',
          tag: name,
          text: summary,
          detail: [JSON.stringify(item.input, null, 2), item.output].filter(Boolean).join('\n\n'),
          failed: item.status === 'failed',
        })
        break
      }
      case 'approval':
        add({
          ...base,
          lane: 'tools',
          kind: 'approval',
          end,
          instant: false,
          label: `approval · ${item.title}`,
          actor: 'Approval',
          tag: item.decision ?? 'waiting',
          text: item.title,
          detail: JSON.stringify(item.input, null, 2),
        })
        break
      case 'subagent':
      case 'workflow':
        add({
          ...base,
          lane: 'tools',
          kind: 'tool',
          end,
          instant: false,
          label: item.kind === 'subagent' ? `Agent · ${item.title}` : `Workflow · ${item.name}`,
          actor: 'Tool',
          tag: item.kind,
          text: item.kind === 'subagent' ? item.title : item.name,
          detail: item.kind === 'subagent' ? item.prompt : item.description,
          failed: item.status === 'failed',
        })
        break
      case 'question':
        add({
          ...inTurn,
          kind: 'ask',
          end: item.createdAt,
          instant: true,
          label: `? ${item.questions[0]?.question ?? ''}`,
          tag: 'question',
          text: item.questions.map((question) => question.question).join(' / '),
          detail: JSON.stringify(item.questions, null, 2),
        })
        break
      case 'error':
        add({
          ...inTurn,
          kind: 'error',
          end: item.createdAt,
          instant: true,
          label: oneLine(item.message),
          tag: 'error',
          text: oneLine(item.message),
          detail: item.message,
          failed: true,
        })
        break
      case 'image_gallery':
      case 'video':
      case 'plan':
        add({
          ...inTurn,
          kind: 'bubble',
          end,
          instant: false,
          label: item.kind === 'plan' ? oneLine(item.text) : item.kind,
          tag: item.kind,
          text: item.kind === 'plan' ? oneLine(item.text) : (item.caption ?? item.kind),
        })
        break
      case 'compaction':
      case 'background_stopped':
        add({
          ...base,
          lane: 'harness',
          kind: 'harness',
          end: item.kind === 'compaction' ? end : item.createdAt,
          instant: item.kind !== 'compaction',
          label: item.kind === 'compaction' ? 'compaction' : 'background stopped',
          actor: 'Jetty',
          tag: item.kind,
          text:
            item.kind === 'compaction' ? `Compaction ${item.status}` : 'Background work stopped',
          loud: true,
        })
        break
      case 'thread_marker': {
        const known = workerIds.has(item.threadId)
        // → the worker's lane when it's ours, else tools (another bot's thread).
        add({
          ...base,
          lane: known ? `worker:${item.threadId}` : 'tools',
          kind: 'marker',
          end: item.createdAt,
          instant: true,
          label: known ? item.action : `${item.action} · ${item.title}`,
          actor: bot.name,
          tag: item.action,
          text: item.title,
        })
        break
      }
      case 'pull_request':
        add({
          ...base,
          lane: 'wakes',
          kind: 'wake',
          end: item.createdAt,
          instant: true,
          label: `PR #${item.number} · ${item.activity.map((activity) => activity.type).join(', ')}`,
          actor: 'PR watcher',
          tag: item.held ? 'held' : 'pull request',
          text: `${item.repo}#${item.number} ${item.activity.map((activity) => activity.type).join(', ')}`,
          quiet: true,
        })
        break
    }
  }

  // Tool calls that start or message a worker hand off to its next turn.
  for (const span of spans) {
    if (span.lane !== 'tools' || span.kind !== 'tool') continue
    const haystack = JSON.stringify(span.raw.map((raw) => (raw.kind === 'event' ? raw.event : '')))
    for (const workerId of workerIds) {
      if (!haystack.includes(workerId)) continue
      const next = workerTurns
        .get(workerId)
        ?.find((workerTurn) => workerTurn.start >= span.start - 500)
      if (next) link(span, next, next.start)
    }
  }

  mapTranscript(sources.transcript, spans, messageSpans, add, unmapped)

  // Packing: spans that overlap in time take another row in their lane.
  const laneRows = new Map<string, number>()
  const rowEnds = new Map<string, number[]>()
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.parent) continue
    const ends = rowEnds.get(span.lane) ?? []
    rowEnds.set(span.lane, ends)
    let row = ends.findIndex((end) => end <= span.start)
    if (row === -1) row = Math.min(ends.length, 3)
    ends[row] = span.instant ? span.start : (span.end ?? Infinity)
    span.row = row
    laneRows.set(span.lane, Math.max(laneRows.get(span.lane) ?? 1, row + 1))
  }

  const botColor = bot.color
  const spare = SPARE_COLORS.find((color) => color !== botColor) ?? 'slate'
  const lanes: Lane[] = [
    ...LANES.map((lane) => ({
      id: lane.id,
      label: lane.id === 'bot' ? bot.name : lane.label,
      color: lane.id === 'bot' ? botColor : lane.color === botColor ? spare : lane.color,
      worker: false,
      rows: laneRows.get(lane.id) ?? 1,
    })),
    ...workers
      .map((worker) => ({
        worker,
        first: workerTurns.get(worker.id)?.[0]?.start ?? Infinity,
      }))
      .sort((a, b) => a.first - b.first)
      .map(({ worker }) => ({
        id: `worker:${worker.id}`,
        label: worker.title,
        color: botColor === WORKER_COLOR ? spare : WORKER_COLOR,
        worker: true,
        rows: laneRows.get(`worker:${worker.id}`) ?? 1,
      })),
  ]

  const laneOrder = new Map(lanes.map((lane, index) => [lane.id, index]))
  spans.sort(
    (a, b) =>
      a.start - b.start ||
      (a.parent ? 1 : 0) - (b.parent ? 1 : 0) ||
      (laneOrder.get(a.lane) ?? 0) - (laneOrder.get(b.lane) ?? 0)
  )

  const activity: number[] = []
  for (const row of sources.events) activity.push(row.ts)
  for (const line of sources.transcript) {
    const ts = entryTime(line.entry)
    if (ts) activity.push(ts)
  }
  activity.sort((a, b) => a - b)

  const runningTurn = [...turnSpans.values()].findLast((span) => span.end == null) ?? null
  const workerModels = [
    ...new Set(workers.map((worker) => worker.model ?? worker.provider ?? '').filter(Boolean)),
  ]

  return {
    lanes,
    spans,
    byId,
    links,
    activity,
    runningTurn,
    model: [model, effort].filter(Boolean).join(' '),
    workerModels,
    unmapped,
  }
}

// The Claude Code transcript: entries that mirror a Jetty record join its span's raw records;
// what Jetty never saw becomes a Harness span.

type Block = {
  type?: string
  text?: string
  name?: string
  id?: string
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}
type Message = { role?: string; model?: string; content?: string | Block[] }

// Jetty stamps each message it hands a bot with the time, e.g. "[Thu, 8 Oct 2026, 20:12]".
function unstamped(text: string) {
  return text.replace(/^\[[^\]\n]*\]\n/, '')
}

function entryTime(entry: TranscriptEntry) {
  return typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
}

function entryText(entry: TranscriptEntry) {
  const message = entry.message as Message | undefined
  const content = message?.content ?? (entry.content as string | undefined)
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => (block.type === 'text' && block.text ? [block.text] : []))
    .join('\n')
}

function attachmentLabel(attachment: Record<string, unknown>) {
  const type = String(attachment.type)
  const names = (key: string) => (attachment[key] as string[] | undefined) ?? []
  switch (type) {
    case 'total_tokens_reminder':
      return 'tokens left'
    case 'deferred_tools_delta':
      return `deferred tools +${names('addedNames').length} −${names('removedNames').length}`
    case 'mcp_instructions_delta': {
      const added = names('addedNames')
      const removed = names('removedNames')
      return [
        added.length && `MCP +${added.join(', ')}`,
        removed.length && `MCP −${removed.join(', ')}`,
      ]
        .filter(Boolean)
        .join(' ')
    }
    case 'prompt_snapshot':
      return 'system prompt'
    case 'remote_session_change':
      return 'attribution'
    default:
      return type.replace(/_(reminder|delta|listing)$/, '').replaceAll('_', ' ')
  }
}

function attachmentText(entry: TranscriptEntry) {
  const rendered = entry.rendered as { content?: string }[] | undefined
  if (rendered?.length) return rendered.map((part) => part.content ?? '').join('\n')
  const attachment = entry.attachment as Record<string, unknown>
  if (Array.isArray(attachment.systemPrompt)) return attachment.systemPrompt.join('\n')
  return JSON.stringify(attachment, null, 2)
}

function createMatcher(spans: Span[], keyOf: (span: Span) => number) {
  const sorted = spans.map((span) => ({ span, key: keyOf(span) })).sort((a, b) => a.key - b.key)
  const used = new Set<string>()
  return (t: number, accept: (span: Span) => boolean = () => true) => {
    let low = 0
    let high = sorted.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (sorted[mid]!.key < t - MATCH_MS) low = mid + 1
      else high = mid
    }
    let best: { span: Span; distance: number } | undefined
    for (let index = low; index < sorted.length && sorted[index]!.key <= t + MATCH_MS; index++) {
      const { span, key } = sorted[index]!
      if (used.has(span.id) || !accept(span)) continue
      const distance = Math.abs(key - t)
      if (!best || distance < best.distance) best = { span, distance }
    }
    if (best) used.add(best.span.id)
    return best?.span
  }
}

function mapTranscript(
  lines: TranscriptLine[],
  spans: Span[],
  messageSpans: Span[],
  add: (span: Omit<Span, 'row' | 'links'>) => Span,
  unmapped: Map<string, number>
) {
  const ofKind = (...kinds: SpanKind[]) => spans.filter((span) => kinds.includes(span.kind))
  const completion = (span: Span) => span.end ?? span.start
  const matchThinking = createMatcher(ofKind('thinking'), completion)
  const matchText = createMatcher(ofKind('bubble', 'note'), completion)
  const matchTool = createMatcher(ofKind('tool', 'tell', 'react'), (span) => span.start)
  const byToolUse = new Map<string, Span>()
  const seen = new Set<string>()
  const queued: TranscriptLine[] = []
  let cluster: { span: Span; last: number; types: string[]; texts: string[] } | undefined

  const raw = (line: TranscriptLine): Raw => ({ kind: 'transcript', ...line })
  const harness = (line: TranscriptLine, span: Partial<Span> & Pick<Span, 'label' | 'tag'>) =>
    add({
      id: `transcript:${line.file}:${line.line}`,
      lane: 'harness',
      kind: 'harness',
      start: entryTime(line.entry),
      end: entryTime(line.entry),
      instant: true,
      actor: 'Harness',
      text: span.label,
      raw: [raw(line)],
      ...span,
    })
  const messageFor = (text: string, t: number) => {
    const needle = oneLine(text)
    return messageSpans.find(
      (span) =>
        Math.abs(span.start - t) < MATCH_MS * 2 &&
        needle.includes(span.text.slice(0, 80).replace(/&lt;/g, '<'))
    )
  }

  for (const line of lines) {
    const entry = line.entry
    const uuid = entry.uuid as string | undefined
    if (uuid) {
      if (seen.has(uuid)) continue
      seen.add(uuid)
    }
    const t = entryTime(entry)
    if (Number.isNaN(t)) {
      count(unmapped, `transcript ${entry.type}`)
      continue
    }
    if (entry.type !== 'attachment') cluster = undefined

    switch (entry.type) {
      case 'assistant': {
        const message = entry.message as Message
        if (message.model === '<synthetic>') {
          // → harness: Claude Code wrote this as the model's own reply.
          harness(line, {
            label: `synthetic reply · ${oneLine(entryText(entry))}`,
            tag: 'synthetic',
            text: oneLine(entryText(entry)),
            detail: entryText(entry),
            loud: true,
          })
          break
        }
        for (const block of Array.isArray(message.content) ? message.content : []) {
          const span =
            block.type === 'thinking'
              ? matchThinking(t)
              : block.type === 'text'
                ? matchText(t)
                : block.type === 'tool_use'
                  ? matchTool(t, (candidate) => candidate.tag === shortTool(block.name ?? ''))
                  : undefined
          const said =
            block.type === 'tool_use' ? shortTool(block.name ?? '') : oneLine(block.text ?? '')
          // → harness: model output Jetty never recorded (a second process on the session, say).
          const target =
            span ??
            harness(line, {
              id: `transcript:${line.file}:${line.line}:${block.type}`,
              label: `unrecorded ${block.type}${said ? ` · ${said}` : ''}`,
              tag: `unrecorded ${block.type}`,
              detail: block.type === 'tool_use' ? JSON.stringify(block, null, 2) : block.text,
              loud: true,
            })
          if (span) span.raw.push(raw(line))
          if (block.type === 'tool_use' && block.id) byToolUse.set(block.id, target)
        }
        break
      }
      case 'user': {
        const message = entry.message as Message
        const blocks = Array.isArray(message.content) ? message.content : []
        const results = blocks.filter((block) => block.type === 'tool_result')
        if (results.length) {
          for (const block of results) {
            const span = byToolUse.get(block.tool_use_id ?? '')
            if (!span) count(unmapped, 'transcript tool_result')
            if (!span) continue
            span.raw.push(raw(line))
            if (block.is_error) span.failed = true
            if (span.kind === 'harness')
              span.detail = `${span.detail ?? ''}\n\n→ ${typeof block.content === 'string' ? block.content : JSON.stringify(block.content)}`
          }
          break
        }
        const text = entryText(entry)
        if (entry.isMeta) {
          // → harness: a user message only the model sees.
          harness(line, {
            label: oneLine(text),
            tag: 'meta',
            detail: text,
            loud: true,
          })
          break
        }
        if (entry.isCompactSummary) {
          harness(line, {
            label: 'compaction summary',
            tag: 'compaction',
            detail: text,
            loud: true,
          })
          break
        }
        const matched = messageFor(text, t)
        if (matched) {
          matched.raw.push(raw(line))
          break
        }
        // → harness: a user turn Jetty didn't send (task notifications and the like).
        const tag = /^<([\w-]+)>/.exec(unstamped(text))?.[1] ?? 'user'
        harness(line, { label: oneLine(unstamped(text)), tag, detail: text, loud: true })
        break
      }
      case 'attachment': {
        const attachment = entry.attachment as Record<string, unknown>
        const type = String(attachment.type)
        if (!entry.rendered && !UNRENDERED_SEEN.has(type)) {
          count(unmapped, `attachment ${type}`)
          break
        }
        const label = attachmentLabel(attachment)
        const loud = LOUD_ATTACHMENTS.has(type) || type.startsWith('hook_')
        if (cluster && t - cluster.last < 500) {
          // → harness: reminders injected together read as one.
          cluster.last = t
          cluster.types.push(type)
          cluster.texts.push(attachmentText(entry))
          const span = cluster.span
          span.label = `${span.label} · ${label}`
          span.text = span.label
          span.detail = cluster.texts.join('\n\n')
          span.quiet = span.quiet && QUIET_ATTACHMENTS.has(type)
          span.loud = span.loud || loud
          span.tag = 'reminders'
          span.raw.push(raw(line))
          break
        }
        const span = harness(line, {
          label,
          tag: loud ? type.replaceAll('_', ' ') : 'reminder',
          detail: attachmentText(entry),
          quiet: QUIET_ATTACHMENTS.has(type),
          loud,
        })
        cluster = { span, last: t, types: [type], texts: [span.detail ?? ''] }
        break
      }
      case 'queue-operation': {
        const operation = String(entry.operation)
        if (operation === 'enqueue') {
          queued.push(line)
          break
        }
        const enqueued = operation === 'dequeue' ? queued.shift() : undefined
        if (!enqueued) {
          harness(line, { label: `queue ${operation}`, tag: 'queue' })
          break
        }
        const content = String(enqueued.entry.content ?? '')
        const waited = t - entryTime(enqueued.entry)
        const message = messageFor(content, entryTime(enqueued.entry))
        if (waited <= STEER_MS && message) {
          message.raw.push(raw(enqueued), raw(line))
          break
        }
        // → harness: a message that waited in Claude Code's queue (steering).
        const span = harness(enqueued, {
          end: t,
          instant: false,
          label: `queued ${formatDuration(waited)} · ${oneLine(unstamped(content))}`,
          tag: 'queued',
          text: oneLine(unstamped(content)),
          detail: content,
          loud: true,
        })
        span.raw.push(raw(line))
        break
      }
      case 'system': {
        const subtype = String(entry.subtype ?? 'system')
        harness(line, {
          label: subtype === 'compact_boundary' ? 'compaction' : `system · ${subtype}`,
          tag: subtype,
          detail: entryText(entry) || JSON.stringify(entry, null, 2),
          loud: subtype === 'compact_boundary',
        })
        break
      }
      default:
        count(unmapped, `transcript ${entry.type}`)
    }
  }
  for (const line of queued)
    harness(line, {
      label: `queued · ${oneLine(unstamped(String(line.entry.content ?? '')))}`,
      tag: 'queued',
      end: null,
      instant: false,
      loud: true,
    })
}

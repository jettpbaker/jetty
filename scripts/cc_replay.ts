import type { SdkLikeMessage } from '../server/src/claude-translate'
import type { EffortLevel, ThreadEvent } from '../shared/src/events'

import { createTranslateCtx, translate } from '../server/src/claude-translate'
import { newId } from '../shared/src/wire'

type Block = {
  type: string
  text?: string
  thinking?: string
  tool_use_id?: string
}
type Row = SdkLikeMessage & {
  uuid?: string
  timestamp: string
  cwd?: string
  isSidechain?: boolean
  perTurnEffort?: EffortLevel
  effort?: EffortLevel
  message?: SdkLikeMessage['message'] & { content?: string | Block[] }
}

function blocks(row: Row): Block[] {
  const content = row.message?.content
  return typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? [])
}

function isPrompt(row: Row) {
  return row.type === 'user' && !blocks(row).some((block) => block.type === 'tool_result')
}

function timestamp(row: Row) {
  const time = Date.parse(row.timestamp)
  if (!Number.isFinite(time)) throw new Error(`Missing or invalid timestamp: ${row.uuid}`)
  return time
}

function percentile(values: number[], quantile: number) {
  const sorted = values.toSorted((a, b) => a - b)
  const index = (sorted.length - 1) * quantile
  const low = Math.floor(index)
  return sorted[low]! + (sorted[Math.ceil(index)]! - sorted[low]!) * (index - low)
}

async function main() {
  const [path, which, out] = process.argv.slice(2)
  if (!path || !which || !out) {
    throw new Error(
      'usage: bun scripts/cc_replay.ts <transcript.jsonl> <which turn (1-based or UUID)> <out.json>'
    )
  }
  const rows = (await Bun.file(path).text())
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Row)
    .filter((row) => !row.isSidechain && row.parent_tool_use_id == null)
    .filter((row) => row.type === 'user' || row.type === 'assistant')
  const turns: Row[][] = []
  for (const row of rows) {
    if (isPrompt(row)) turns.push([])
    turns.at(-1)?.push(row)
  }
  const selected = /^\d+$/.test(which)
    ? turns[Number(which) - 1]
    : turns.find((turn) => turn[0]?.uuid === which)
  if (!selected?.length) throw new Error(`No main-thread turn ${which}`)
  const prompt = selected[0]!
  const start = timestamp(prompt)
  const turnId = prompt.uuid ?? newId()
  const ctx = createTranslateCtx(turnId)
  const events: { t: number; event: ThreadEvent }[] = []
  function emit(time: number, event: ThreadEvent) {
    if (time < start) throw new Error('Turn contains a timestamp before its user message')
    events.push({
      t: time - start,
      event:
        event.type === 'item.started'
          ? { ...event, item: { ...event.item, createdAt: time } }
          : event,
    })
  }
  const text = blocks(prompt)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
  const userId = newId()
  emit(start, {
    type: 'item.started',
    item: { id: userId, turnId, createdAt: start, kind: 'user_message', text, attachments: [] },
  })
  emit(start, { type: 'item.completed', itemId: userId })
  const firstAssistant = selected.find((row) => row.type === 'assistant')
  const model = firstAssistant?.message?.model
  const effort = firstAssistant?.perTurnEffort ?? firstAssistant?.effort
  emit(start, {
    type: 'turn.started',
    turnId,
    ...(model ? { loadout: { model, ...(effort ? { effort } : {}) } } : {}),
  })
  let previousResult = start
  const steps = new Map<string, { start: number; end: number }>()
  let lastAssistant: Row | undefined
  for (const row of selected.slice(1)) {
    const time = timestamp(row)
    if (row.type === 'assistant') {
      lastAssistant = row
      // Claude splits a single model response into rows sharing the message ID.
      const key = row.message?.id ?? row.uuid ?? String(time)
      const step = steps.get(key)
      if (step) step.end = Math.max(step.end, time)
      else steps.set(key, { start: previousResult, end: time })
    }
    for (const block of blocks(row)) {
      const translated = translate({ ...row, message: { ...row.message, content: [block] } }, ctx)
      for (const event of translated) {
        if (event.type === 'item.started' && event.item.kind === 'reasoning') {
          emit(previousResult, { ...event, item: { ...event.item, text: '' } })
          emit(time, { type: 'item.delta', itemId: event.item.id, delta: event.item.text })
        } else emit(time, event)
      }
    }
    if (row.type === 'user' && blocks(row).some((block) => block.type === 'tool_result'))
      previousResult = time
  }
  if (!lastAssistant || !blocks(lastAssistant).some((block) => block.type === 'text')) {
    throw new Error('Turn has no final text answer; refusing an incomplete replay')
  }
  const running = new Set<string>()
  for (const { event } of events) {
    if (event.type === 'item.started' && event.item.kind === 'tool_call') running.add(event.item.id)
    if (event.type === 'item.completed') running.delete(event.itemId)
  }
  if (running.size) throw new Error(`Turn has ${running.size} unfinished tool calls`)
  const end = Math.max(...selected.map(timestamp))
  emit(end, { type: 'turn.completed', turnId })
  events.sort((a, b) => a.t - b.t)
  await Bun.write(
    out,
    `${JSON.stringify({ title: text.split('\n')[0]?.slice(0, 100) || 'Claude Code turn', provider: 'claude', projectPath: prompt.cwd ?? '', events }, null, 2)}\n`
  )
  const durations = [...steps.values()].map((step) => (step.end - step.start) / 1000)
  console.log(
    JSON.stringify(
      {
        turn: turns.indexOf(selected) + 1,
        uuid: prompt.uuid,
        timestamp: prompt.timestamp,
        model,
        durationSeconds: (end - start) / 1000,
        steps: durations,
        modelTimeMedianSeconds: percentile(durations, 0.5),
        modelTimeP90Seconds: percentile(durations, 0.9),
        out,
      },
      null,
      2
    )
  )
}

await main()

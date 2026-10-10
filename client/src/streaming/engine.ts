import { ThreadEvent } from '@jetty/shared/events'
import { Schema } from 'effect'

const Offset = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const Input = Schema.Struct({
  seq: Schema.Int.check(Schema.isGreaterThan(0)),
  atMs: Offset,
  event: Schema.Union([
    ThreadEvent,
    Schema.Struct({ type: Schema.Literal('local.turn.interrupted'), turnId: Schema.String }),
  ]),
})
const Recording = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  fidelity: Schema.Literals(['synthetic', 'server-observed']),
  durationMs: Offset,
  capture: Schema.Literals(['complete', 'incomplete']),
  inputs: Schema.Array(Input),
})

export type StreamInput = Schema.Schema.Type<typeof Input>
export type StreamRecording = Schema.Schema.Type<typeof Recording>
export type StreamCursor = { atMs: number; eventCount: number }
export type StreamTurn = {
  id: string
  outcome: 'running' | 'completed' | 'failed' | 'interrupted'
  error?: string
}
export type AssistantText = { id: string; turnId: string; text: string; completed: boolean }
export type StreamSemantic = { turns: readonly StreamTurn[]; texts: readonly AssistantText[] }
export type StreamPresentation = StreamSemantic & {
  captureEnded: boolean
  captureIncomplete: boolean
}

function emptySemantic(): StreamSemantic {
  return { turns: [], texts: [] }
}

export function reduceStream(state: StreamSemantic, { event }: StreamInput): StreamSemantic {
  switch (event.type) {
    case 'turn.started':
      return { ...state, turns: [...state.turns, { id: event.turnId, outcome: 'running' }] }
    case 'turn.completed':
    case 'turn.failed':
    case 'local.turn.interrupted': {
      const outcome =
        event.type === 'turn.completed'
          ? 'completed'
          : event.type === 'turn.failed'
            ? 'failed'
            : 'interrupted'
      return {
        ...state,
        turns: state.turns.map((turn) =>
          turn.id === event.turnId
            ? { id: turn.id, outcome, ...(event.type === 'turn.failed' && { error: event.error }) }
            : turn
        ),
      }
    }
    case 'item.started': {
      const item = event.item
      if (item.kind !== 'assistant_message' || item.agentId) return state
      return {
        ...state,
        texts: [
          ...state.texts,
          {
            id: item.id,
            turnId: item.turnId,
            text: item.text,
            completed: item.streaming === false,
          },
        ],
      }
    }
    case 'item.delta':
      return {
        ...state,
        texts: state.texts.map((text) =>
          text.id === event.itemId ? { ...text, text: text.text + event.delta } : text
        ),
      }
    case 'item.updated':
    case 'item.completed':
      return {
        ...state,
        texts: state.texts.map((text) =>
          text.id === event.itemId
            ? {
                ...text,
                text: typeof event.patch?.text === 'string' ? event.patch.text : text.text,
                completed: event.type === 'item.completed' || text.completed,
              }
            : text
        ),
      }
    default:
      return state
  }
}

export function projectStream(
  semantic: StreamSemantic,
  cursor: StreamCursor,
  recording: Pick<StreamRecording, 'durationMs' | 'capture'>
): StreamPresentation {
  const captureEnded = cursor.atMs >= recording.durationMs
  return {
    ...semantic,
    captureEnded,
    captureIncomplete: captureEnded && recording.capture === 'incomplete',
  }
}

function inputKey(input: StreamInput): string {
  return JSON.stringify(input, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    )
  })
}

export function createStreamEngine() {
  let inputs: readonly StreamInput[] = []
  let semantic = emptySemantic()

  function admit(batch: readonly StreamInput[]) {
    const next = [...inputs]
    let nextSemantic = semantic
    for (const value of batch) {
      const input = Schema.decodeUnknownSync(Input)(value)
      const previous = next[input.seq - 1]
      if (previous) {
        if (inputKey(previous) !== inputKey(input))
          throw new Error(`Conflicting input ${input.seq}`)
        continue
      }
      if (input.seq !== next.length + 1) throw new Error(`Missing input before ${input.seq}`)
      if (input.atMs < (next.at(-1)?.atMs ?? 0)) throw new Error(`Backward time at ${input.seq}`)
      next.push(input)
      nextSemantic = reduceStream(nextSemantic, input)
    }
    inputs = next
    semantic = nextSemantic
  }

  function at(cursor: StreamCursor): StreamSemantic {
    if (
      !Number.isFinite(cursor.atMs) ||
      cursor.atMs < 0 ||
      !Number.isInteger(cursor.eventCount) ||
      cursor.eventCount < 0 ||
      cursor.eventCount > inputs.length ||
      (cursor.eventCount > 0 && inputs[cursor.eventCount - 1]!.atMs > cursor.atMs)
    )
      throw new Error('Invalid stream cursor')
    if (cursor.eventCount === inputs.length) return semantic
    let state = emptySemantic()
    for (const input of inputs.slice(0, cursor.eventCount)) state = reduceStream(state, input)
    return state
  }

  return { admit, at }
}

export function loadRecording(value: unknown): StreamRecording {
  const recording = Schema.decodeUnknownSync(Recording)(value)
  const engine = createStreamEngine()
  engine.admit(recording.inputs)
  if (recording.inputs.some((input) => input.atMs > recording.durationMs))
    throw new Error('Input extends beyond capture')
  if (recording.inputs.some((input, index) => input.seq !== index + 1))
    throw new Error('Recording must contain each input once, in order')
  return recording
}

export function cursorAt(recording: StreamRecording, atMs: number): StreamCursor {
  if (!Number.isFinite(atMs)) throw new Error('Invalid seek time')
  const time = Math.max(0, Math.min(recording.durationMs, atMs))
  let eventCount = 0
  for (const input of recording.inputs) {
    if (input.atMs > time) break
    eventCount++
  }
  return { atMs: time, eventCount }
}

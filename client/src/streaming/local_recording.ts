import { Schema } from 'effect'

import { loadRecording } from './engine'

const Manifest = Schema.Struct({
  fidelity: Schema.Literal('server-observed'),
  clock: Schema.String,
  requested: Schema.Struct({ effort: Schema.String }),
  observed: Schema.Struct({ model: Schema.String, effort: Schema.String }),
  outcome: Schema.Struct({
    capture: Schema.Struct({
      closed: Schema.Boolean,
      complete: Schema.Boolean,
      sourceCount: Schema.Natural,
      writtenRecords: Schema.Natural,
    }),
  }),
  mapping: Schema.Array(
    Schema.Struct({
      viewerSeq: Schema.Int.check(Schema.isGreaterThan(0)),
      tapeSeq: Schema.Int.check(Schema.isGreaterThan(0)),
      sourceSeq: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
    })
  ),
})

export function loadLocalRecording(value: unknown, manifestValue: unknown) {
  try {
    const recording = loadRecording(value)
    const manifest = Schema.decodeUnknownSync(Manifest)(manifestValue)
    const capture = manifest.outcome.capture
    if (
      recording.fidelity !== manifest.fidelity ||
      manifest.mapping.length !== recording.inputs.length ||
      (recording.capture === 'complete') !== capture.complete ||
      (capture.complete && !capture.closed)
    )
      throw new Error('Inconsistent recording provenance')
    let previousTapeSeq = 0
    for (const [index, mapping] of manifest.mapping.entries()) {
      if (
        mapping.viewerSeq !== recording.inputs[index]!.seq ||
        mapping.tapeSeq <= previousTapeSeq ||
        mapping.tapeSeq > capture.writtenRecords ||
        (mapping.sourceSeq !== null && mapping.sourceSeq > capture.sourceCount)
      )
        throw new Error('Invalid recording mapping')
      previousTapeSeq = mapping.tapeSeq
    }
    const assistantIds = new Set<string>()
    for (const { event } of recording.inputs) {
      if (
        ![
          'turn.started',
          'turn.completed',
          'turn.failed',
          'local.turn.interrupted',
          'item.started',
          'item.delta',
          'item.updated',
          'item.completed',
        ].includes(event.type) ||
        (event.type === 'item.started' &&
          (event.item.kind !== 'assistant_message' || event.item.agentId))
      )
        throw new Error('Recording is not a main-thread assistant/turn projection')
      if (event.type === 'item.started') {
        if (assistantIds.has(event.item.id)) throw new Error('Duplicate assistant identity')
        assistantIds.add(event.item.id)
      } else if (
        (event.type === 'item.delta' ||
          event.type === 'item.updated' ||
          event.type === 'item.completed') &&
        !assistantIds.has(event.itemId)
      )
        throw new Error('Unknown assistant identity')
    }
    return {
      recording,
      provenance: {
        clock: manifest.clock,
        model: manifest.observed.model,
        requestedEffort: manifest.requested.effort,
        observedEffort: manifest.observed.effort,
        mappedInputs: manifest.mapping.length,
      },
    }
  } catch {
    throw new Error('Local recording or provenance could not be validated')
  }
}

export type LocalRecording = ReturnType<typeof loadLocalRecording>

function discoverLocalRecording() {
  if (!import.meta.env?.DEV) return { recording: undefined, invalid: false }
  const files = import.meta.glob('/streaming-replay.local/recording.*.json', {
    eager: true,
    import: 'default',
  })
  const value = files['/streaming-replay.local/recording.viewer.json']
  const manifest = files['/streaming-replay.local/recording.manifest.json']
  if (!value && !manifest) return { recording: undefined, invalid: false }
  try {
    return { recording: loadLocalRecording(value, manifest), invalid: false }
  } catch {
    return { recording: undefined, invalid: true }
  }
}

export const localInput = discoverLocalRecording()

import { createStreamEngine, type StreamCursor, type StreamRecording } from './engine'

export type DeliveryMode = 'batched' | 'catch-up'

export function createDeliverySimulation(recording: StreamRecording, mode: DeliveryMode) {
  let engine = createStreamEngine()
  let admitted = 0
  let batches = 0
  let duplicates = 0

  function advance(cursor: StreamCursor) {
    if (cursor.eventCount < admitted) {
      engine = createStreamEngine()
      admitted = 0
      batches = 0
      duplicates = 0
    }
    const size = mode === 'catch-up' ? Math.max(1, cursor.eventCount - admitted) : 3
    while (admitted < cursor.eventCount) {
      const end = Math.min(cursor.eventCount, admitted + size)
      const batch = recording.inputs.slice(admitted, end)
      engine.admit(batch)
      engine.admit(batch)
      batches++
      duplicates += batch.length
      admitted = end
    }
    return { semantic: engine.at(cursor), admitted, batches, duplicates }
  }

  return { advance }
}

import { cursorAt, type StreamCursor, type StreamRecording } from './engine'

export type Playback = { cursor: StreamCursor; playing: boolean; speed: number }

export function createPlaybackClock(recording: StreamRecording) {
  let state: Playback = { cursor: { atMs: 0, eventCount: 0 }, playing: false, speed: 1 }
  let anchor: number | undefined
  const listeners = new Set<() => void>()

  function publish(next: Playback) {
    state = next
    for (const listener of listeners) listener()
  }

  function tick(nowMs: number) {
    if (!state.playing) return
    if (anchor === undefined) {
      anchor = nowMs
      return
    }
    const atMs = state.cursor.atMs + Math.max(0, nowMs - anchor) * state.speed
    anchor = nowMs
    publish({ ...state, cursor: cursorAt(recording, atMs), playing: atMs < recording.durationMs })
  }

  function play(nowMs: number) {
    const cursor =
      state.cursor.atMs >= recording.durationMs ? { atMs: 0, eventCount: 0 } : state.cursor
    anchor = nowMs
    publish({ ...state, cursor, playing: true })
  }

  function pause(nowMs: number) {
    tick(nowMs)
    anchor = undefined
    publish({ ...state, playing: false })
  }

  function seek(atMs: number) {
    anchor = undefined
    publish({ ...state, cursor: cursorAt(recording, atMs), playing: false })
  }

  function step(direction: -1 | 1) {
    const eventCount = Math.max(
      0,
      Math.min(recording.inputs.length, state.cursor.eventCount + direction)
    )
    anchor = undefined
    publish({
      ...state,
      cursor: { atMs: recording.inputs[eventCount - 1]?.atMs ?? 0, eventCount },
      playing: false,
    })
  }

  function speed(value: number, nowMs: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid playback speed')
    tick(nowMs)
    anchor = state.playing ? nowMs : undefined
    publish({ ...state, speed: value })
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { snapshot: () => state, subscribe, tick, play, pause, seek, step, speed }
}

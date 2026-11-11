// Where a pinned chat rests: the end of the transcript, not the end of the scrollport.
// The port stays taller than the transcript while a spring keeps room to brake after a long turn
// collapses. Resting on the port's end shows that empty padding, with the reply above the window.
export function pinnedScrollTop(transcript: number, clientHeight: number) {
  return Math.max(0, transcript - clientHeight)
}

// `bottom` is the scroll offset where the transcript ends. The scrollport's own end includes braking
// room when this is true, and following it (the virtualizer's align-end on the last row) sits in
// that padding. When this is false, that follow is what lets a long thread's estimates grow into
// the landing instead of stopping short.
export function brakingRoom(bottom: number, scrollHeight: number, clientHeight: number) {
  return scrollHeight - clientHeight - bottom > 1
}

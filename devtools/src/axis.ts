import { formatClock, formatDay, formatDuration } from './format'

// Quiet stretches longer than this collapse into a break marker.
export const IDLE_GAP_MS = 30_000
const PAD_MS = 2_000
const BREAK_MAX = 44
const BREAK_MIN = 10
const CHAR_PX = 6.4
const TICK_SPACING = 96
const STEPS = [
  100, 250, 500, 1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5, 72e5, 216e5,
  432e5, 864e5,
]

export type AxisLabel = { kind: 'tick' | 'break'; x: number; left: number; text: string }

// A stretch of activity drawn at the current scale. `offset` is the active time before it.
export type Segment = { start: number; end: number; offset: number }

export function segmentsFor(points: readonly number[]) {
  const segments: Segment[] = []
  for (const t of points) {
    const last = segments.at(-1)
    if (last && t - (last.end - PAD_MS) <= IDLE_GAP_MS) {
      last.end = Math.max(last.end, t + PAD_MS)
      continue
    }
    const offset = last ? last.offset + last.end - last.start : 0
    segments.push({ start: t - PAD_MS, end: t + PAD_MS, offset })
  }
  return segments
}

export function withNow(segments: readonly Segment[], now: number) {
  const last = segments.at(-1)
  if (last && now - (last.end - PAD_MS) <= IDLE_GAP_MS)
    return [...segments.slice(0, -1), { ...last, end: Math.max(last.end, now + PAD_MS) }]
  const offset = last ? last.offset + last.end - last.start : 0
  return [...segments, { start: now - PAD_MS, end: now + PAD_MS, offset }]
}

function breakWidthFor(scale: number) {
  return Math.min(BREAK_MAX, Math.max(BREAK_MIN, scale * 4000))
}

export type Axis = ReturnType<typeof createAxis>

// Maps time to x in content pixels: active stretches at `scale` px/ms, breaks at a fixed width.
export function createAxis(segments: readonly Segment[], scale: number) {
  const breakWidth = breakWidthFor(scale)
  const last = segments.length - 1
  const startX = (index: number) => segments[index]!.offset * scale + index * breakWidth
  const endX = (index: number) =>
    startX(index) + (segments[index]!.end - segments[index]!.start) * scale

  function lastIndexAtOrBefore(value: number, of: (index: number) => number) {
    let low = 0
    let high = last
    let found = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (of(mid) <= value) {
        found = mid
        low = mid + 1
      } else high = mid - 1
    }
    return found
  }

  function x(t: number) {
    const index = lastIndexAtOrBefore(t, (i) => segments[i]!.start)
    if (index === -1) return (t - (segments[0]?.start ?? t)) * scale
    const segment = segments[index]!
    if (t <= segment.end || index === last) return startX(index) + (t - segment.start) * scale
    const next = segments[index + 1]!
    return endX(index) + ((t - segment.end) / (next.start - segment.end)) * breakWidth
  }

  function time(px: number) {
    const index = lastIndexAtOrBefore(px, startX)
    if (index === -1) return (segments[0]?.start ?? Date.now()) + px / scale
    const segment = segments[index]!
    if (px <= endX(index) || index === last) return segment.start + (px - startX(index)) / scale
    const next = segments[index + 1]!
    return segment.end + ((px - endX(index)) / breakWidth) * (next.start - segment.end)
  }

  const breaks = segments.slice(0, -1).map((segment, index) => ({
    x: endX(index),
    width: breakWidth,
    gap: segments[index + 1]!.start - segment.end + 2 * PAD_MS,
  }))

  // Axis text, greedily kept clear of each other: idle lengths first, then the clock time where
  // each stretch resumes, then evenly spaced ticks.
  function labels(from: number, to: number) {
    const step = STEPS.find((candidate) => candidate * scale >= TICK_SPACING) ?? STEPS.at(-1)!
    const precision = step < 1e3 ? 'tenths' : step < 6e4 ? 'seconds' : 'minutes'
    const zone = new Date().getTimezoneOffset() * 6e4
    const taken: [number, number][] = []
    const result: AxisLabel[] = []
    const place = (label: AxisLabel) => {
      const right = label.left + label.text.length * CHAR_PX + 8
      if (label.left > to || right < from) return
      if (taken.some(([a, b]) => label.left < b && right > a)) return
      taken.push([label.left, right])
      result.push(label)
    }
    for (const gap of breaks) {
      const text = formatDuration(gap.gap).replace(/(\d+m) \d+s$/, '$1')
      const left = gap.x + gap.width / 2 - (text.length * CHAR_PX) / 2
      place({ kind: 'break', x: gap.x, left, text })
    }
    for (const [index, segment] of segments.entries()) {
      if (endX(index) < from || startX(index) > to) continue
      const resumed = segment.start + PAD_MS
      place({
        kind: 'tick',
        x: x(resumed),
        left: x(resumed),
        text: formatClock(resumed, precision === 'minutes' ? 'minutes' : 'seconds'),
      })
    }
    for (const [index, segment] of segments.entries()) {
      if (endX(index) < from || startX(index) > to) continue
      const first = Math.ceil((segment.start - zone) / step) * step + zone
      for (let t = first; t <= segment.end; t += step) {
        const date = new Date(t)
        const midnight = date.getHours() === 0 && date.getMinutes() === 0 && step >= 6e4
        const px = x(t)
        place({
          kind: 'tick',
          x: px,
          left: px,
          text: midnight ? formatDay(t) : formatClock(t, precision),
        })
      }
    }
    return result
  }

  return { scale, width: last >= 0 ? endX(last) : 0, x, time, breaks, labels }
}

export function fitScale(segments: readonly Segment[], width: number) {
  const active = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0)
  const breaks = Math.max(0, segments.length - 1)
  let low = 1e-7
  let high = 2
  for (let step = 0; step < 40; step++) {
    const mid = Math.sqrt(low * high)
    if (active * mid + breaks * breakWidthFor(mid) <= width) low = mid
    else high = mid
  }
  return low
}

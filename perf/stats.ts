// Medians and percentile-bootstrap 95% CIs. Seeded, so the same samples give the same report.

export function median(values: number[]) {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function random(seed = 0x9e3779b9) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function resample(values: number[], next: () => number) {
  return values.map(() => values[Math.floor(next() * values.length)]!)
}

function interval(samples: number[]): [number, number] {
  const sorted = samples.sort((a, b) => a - b)
  return [sorted[Math.floor(sorted.length * 0.025)]!, sorted[Math.ceil(sorted.length * 0.975) - 1]!]
}

const rounds = 2000

export function medianCI(values: number[]): [number, number] {
  if (values.length < 2) return [median(values), median(values)]
  const next = random()
  return interval(Array.from({ length: rounds }, () => median(resample(values, next))))
}

// CI of median(b) − median(a): how much B moved relative to A.
export function medianDiffCI(a: number[], b: number[]): [number, number] {
  if (a.length < 2 || b.length < 2) return [median(b) - median(a), median(b) - median(a)]
  const next = random()
  return interval(
    Array.from({ length: rounds }, () => median(resample(b, next)) - median(resample(a, next)))
  )
}

export function round(value: number, places = 1) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

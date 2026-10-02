export type PerfRecord = {
  v: 1
  t: number
  sid: string
  k: 'journey' | 'mark' | 'loaf' | 'event' | 'shift' | 'ws' | 'snapshot'
  n: string
  d?: number
  jid?: string
  a?: Record<string, number | string | boolean>
}

const capacity = 2000
const flushAt = 500
const flushEveryMs = 10_000
// keepalive requests share a 64 KB in-flight budget per page.
const maxBodyChars = 60_000

const ring: PerfRecord[] = []
let head = 0
let unsent: PerfRecord[] = []
let journeys: PerfRecord[] = []

export const sid = crypto.randomUUID().slice(0, 8)

export function epoch(now = performance.now()) {
  return Math.round((performance.timeOrigin + now) * 10) / 10
}

export function push(record: PerfRecord) {
  if (ring.length < capacity) ring.push(record)
  else ring[head] = record
  head = (head + 1) % capacity
  unsent.push(record)
  if (record.k === 'journey') journeys.push(record)
  if (journeys.length > capacity) journeys = journeys.slice(-capacity)
  if (unsent.length >= flushAt) flush()
}

export function recent(n = 50) {
  const ordered = ring.length < capacity ? ring : [...ring.slice(head), ...ring.slice(0, head)]
  return ordered.slice(-n)
}

export function take() {
  const taken = journeys
  journeys = []
  return taken
}

function flush() {
  if (unsent.length === 0) return
  const lines = unsent.map((record) => JSON.stringify(record))
  unsent = []
  let body = ''
  for (const line of lines) {
    if (body && body.length + line.length > maxBodyChars) {
      send(body)
      body = ''
    }
    body += `${line}\n`
  }
  send(body)
}

function send(body: string) {
  fetch('/perf', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/x-ndjson' },
    body,
  }).catch(() => {})
}

export function startFlushing(tick: () => void) {
  setInterval(() => {
    tick()
    flush()
  }, flushEveryMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

import {
  enable,
  onCommit,
  recordEvent,
  recordLoaf,
  recordShift,
  settledCounters,
  startAt,
  sweep,
  type Counters,
  type LongAnimationFrame,
} from './index'
import { regionOf } from './regions'
import { recent, startFlushing, take } from './ring'

type DevtoolsHook = {
  onCommitFiberRoot?: (this: DevtoolsHook, ...args: unknown[]) => unknown
  [key: string]: unknown
}

type LayoutShift = PerformanceEntry & {
  value: number
  hadRecentInput: boolean
  sources: { node: Node | null }[]
}

const page = window as typeof window & {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHook
  __jettyPerf?: unknown
}

// Counters around each composer keystroke, matched to its Event Timing entry by start time.
const keys = new Map<number, { base: Counters; end?: Counters }>()
const observers: [PerformanceObserver, (entry: PerformanceEntry) => void][] = []

if (new URLSearchParams(location.search).get('perf') !== 'off') boot()

function boot() {
  enable(drainObservers)
  installHook()
  observe('long-animation-frame', {}, (entry) => recordLoaf(entry as LongAnimationFrame))
  observe('event', { durationThreshold: 16 }, (entry) => {
    const event = entry as PerformanceEventTiming
    if (!event.interactionId) return
    const region = regionOf(event.target)
    const base = event.name === 'keydown' && region === 'composer' ? keyBase(event) : undefined
    recordEvent(event, region, base)
  })
  observe('layout-shift', {}, (entry) => {
    const shift = entry as LayoutShift
    if (shift.hadRecentInput) return
    const node = shift.sources.find((source) => source.node)?.node
    recordShift(shift.value, regionOf(node), shift.startTime)
  })
  document.addEventListener(
    'keydown',
    (event) => {
      if (regionOf(event.target as Node | null) !== 'composer') return
      const key: { base: Counters; end?: Counters } = { base: settledCounters() }
      keys.set(event.timeStamp, key)
      if (keys.size > 16) keys.delete(keys.keys().next().value!)
      requestAnimationFrame(() => setTimeout(() => (key.end = settledCounters()), 0))
    },
    { capture: true, passive: true }
  )
  startFlushing(sweep)
  startAt('app.launch', {}, 0)
  page.__jettyPerf = {
    version: 1,
    counters: settledCounters,
    take,
    recent,
  }
}

function keyBase(entry: PerformanceEventTiming) {
  for (const [at, base] of keys)
    if (Math.abs(at - entry.startTime) < 1) {
      keys.delete(at)
      return base
    }
}

function observe(
  type: string,
  options: { durationThreshold?: number },
  handle: (entry: PerformanceEntry) => void
) {
  if (!PerformanceObserver.supportedEntryTypes.includes(type)) return
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) handle(entry)
  })
  observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit)
  observers.push([observer, handle])
}

function drainObservers() {
  for (const [observer, handle] of observers)
    for (const entry of observer.takeRecords()) handle(entry)
}

// React reports every commit to a DevTools hook it finds at load, in production builds too.
function installHook() {
  const existing = page.__REACT_DEVTOOLS_GLOBAL_HOOK__
  if (existing) {
    const chained = existing.onCommitFiberRoot
    existing.onCommitFiberRoot = function (...args) {
      onCommit()
      return chained?.apply(this, args)
    }
    return
  }
  const renderers = new Map<number, unknown>()
  page.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers,
    inject(renderer: unknown) {
      renderers.set(renderers.size + 1, renderer)
      return renderers.size
    },
    onCommitFiberRoot: onCommit,
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  }
}

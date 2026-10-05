import type { Page } from './driver'
import type { SourceMapper } from './sourcemap'

// Injected by the lab through CDP on every new document, before any app script runs; the app
// never sees or ships it. Counts DOM mutation records, attributes layout shifts to regions,
// keeps long animation frames and tracks the idle callbacks the page is waiting on. Only React
// commits and WebSocket traffic come from the app's own perf module (window.__jettyPerf), since
// only the app can see those.
const labScript = `(() => {
  const lab = { mutations: 0, shifts: {}, loafs: [] }
  Object.defineProperty(window, '__perfLab', { value: lab })
  let activity = () => {}
  new MutationObserver((records) => {
    lab.mutations += records.length
    activity()
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  const idle = new Set()
  const requestIdle = window.requestIdleCallback.bind(window)
  const cancelIdle = window.cancelIdleCallback.bind(window)
  window.requestIdleCallback = (callback, options) => {
    const id = requestIdle((deadline) => {
      idle.delete(id)
      try {
        callback(deadline)
      } finally {
        activity()
      }
    }, options)
    idle.add(id)
    return id
  }
  window.cancelIdleCallback = (id) => {
    idle.delete(id)
    cancelIdle(id)
    activity()
  }
  lab.idleCallbacks = () => idle.size
  // Resolves true once the page has gone ms without a DOM mutation and has no idle callback
  // waiting; false at the timeout. Event-driven, so waiting never wakes the page.
  lab.quiet = (ms, timeout) => new Promise((resolve) => {
    let timer = 0
    const limit = setTimeout(() => end(false), timeout)
    function end(quiet) {
      clearTimeout(timer)
      clearTimeout(limit)
      activity = () => {}
      resolve(quiet)
    }
    activity = () => {
      clearTimeout(timer)
      timer = setTimeout(() => idle.size === 0 && end(true), ms)
    }
    activity()
  })
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue
        const regions = new Set()
        for (const source of entry.sources ?? []) {
          const node = source.node
          const element = node instanceof Element ? node : node?.parentElement
          regions.add(element?.closest('[data-perf-region]')?.getAttribute('data-perf-region') ?? 'other')
        }
        if (regions.size === 0) regions.add('other')
        for (const region of regions) lab.shifts[region] = (lab.shifts[region] ?? 0) + 1
      }
    }).observe({ type: 'layout-shift' })
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        lab.loafs.push({
          start: entry.startTime,
          duration: entry.duration,
          blocking: entry.blockingDuration,
          scripts: entry.scripts.map((script) => ({
            invoker: script.invoker,
            type: script.invokerType,
            url: script.sourceURL,
            fn: script.sourceFunctionName,
            position: script.sourceCharPosition,
            duration: script.duration,
            forced: script.forcedStyleAndLayoutDuration,
          })),
        })
    }).observe({ type: 'long-animation-frame', buffered: true })
  } catch {}
})()`

export async function instrument(page: Page) {
  await page.cdp('Performance.enable', { timeDomain: 'timeTicks' })
  await page.cdp('Profiler.enable')
  await page.cdp('Page.enable')
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: labScript })
  // CSS transitions and animations finish on the next frame instead of running for their
  // duration: how many frames a 150 ms fade gets is timing, not work, and made style-recalc
  // counts drift between iterations.
  await page.cdp('Animation.enable')
  await page.cdp('Animation.setPlaybackRate', { playbackRate: 1000 })
}

// Tier 1 gates and hillclimbs (exact counts); tier 2 is low-noise time; tier 3 is wall-clock.
export const tier1 = [
  'commits',
  'jsCalls',
  'layouts',
  'styleRecalcs',
  'mutations',
  'domNodes',
  'wsMsgs',
  'wsBytes',
  'shifts',
  'loafCount',
] as const
export const tier2 = ['scriptMs', 'taskMs', 'layoutMs', 'recalcMs', 'loafBlockingMs'] as const

export type Counters = Record<string, number>

// The page's counters() has more, but the lab measures LoAF and shifts itself.
const pageCounters = ['commits', 'wsMsgs', 'wsBytes'] as const
type PageCounters = Record<(typeof pageCounters)[number], number>

export type Snapshot = {
  metrics: Record<string, number>
  page: PageCounters | null
  lab: {
    mutations: number
    shifts: Record<string, number>
    loafs: number
    loafBlockingMs: number
  } | null
  domNodes: number
}

export async function snapshot(page: Page): Promise<Snapshot> {
  const { metrics } = await page.cdp<{ metrics: { name: string; value: number }[] }>(
    'Performance.getMetrics'
  )
  const inPage = await page.evaluate<Omit<Snapshot, 'metrics'>>(`({
    page: window.__jettyPerf?.counters() ?? null,
    lab: window.__perfLab ? {
      mutations: __perfLab.mutations,
      shifts: { ...__perfLab.shifts },
      loafs: __perfLab.loafs.length,
      loafBlockingMs: __perfLab.loafs.reduce((sum, loaf) => sum + loaf.blocking, 0),
    } : null,
    domNodes: document.getElementsByTagName('*').length,
  })`)
  return { metrics: Object.fromEntries(metrics.map((m) => [m.name, m.value])), ...inPage }
}

export function delta(before: Snapshot, after: Snapshot): Counters {
  const metric = (name: string) => (after.metrics[name] ?? 0) - (before.metrics[name] ?? 0)
  const ms = (name: string) => Math.round(metric(name) * 1000 * 10) / 10
  const out: Counters = {
    layouts: metric('LayoutCount'),
    styleRecalcs: metric('RecalcStyleCount'),
    mutations: (after.lab?.mutations ?? 0) - (before.lab?.mutations ?? 0),
    loafCount: (after.lab?.loafs ?? 0) - (before.lab?.loafs ?? 0),
    loafBlockingMs:
      Math.round(((after.lab?.loafBlockingMs ?? 0) - (before.lab?.loafBlockingMs ?? 0)) * 10) / 10,
    domNodes: after.domNodes,
    scriptMs: ms('ScriptDuration'),
    taskMs: ms('TaskDuration'),
    layoutMs: ms('LayoutDuration'),
    recalcMs: ms('RecalcStyleDuration'),
  }
  if (after.page)
    for (const key of pageCounters) out[key] = after.page[key] - (before.page?.[key] ?? 0)
  const shifts = after.lab?.shifts ?? {}
  let total = 0
  for (const [region, count] of Object.entries(shifts)) {
    const n = count - (before.lab?.shifts[region] ?? 0)
    if (n) out[`shifts.${region}`] = n
    total += n
  }
  out.shifts = total
  return out
}

// A same-document journey keeps the page's counters, so a delta works. A navigation starts
// new counters; then the "before" is empty.
export const emptySnapshot: Snapshot = { metrics: {}, page: null, lab: null, domNodes: 0 }

type Coverage = {
  result: {
    url: string
    functions: { functionName: string; ranges: { startOffset: number; count: number }[] }[]
  }[]
}

export async function startCoverage(page: Page) {
  await page.cdp('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
}

// Taking coverage also resets V8's counters, so call it once just before the journey and once
// after. Only the app's own chunks count, minus the in-app perf module (the lab's polling calls
// it a timing-dependent number of times).
export async function takeCoverage(page: Page, origin: string, mapper: SourceMapper) {
  const { result } = await page.cdp<Coverage>('Profiler.takePreciseCoverage')
  const byFunction = new Map<string, number>()
  let calls = 0
  for (const script of result) {
    if (!script.url.startsWith(`${origin}/`)) continue
    const file = new URL(script.url).pathname
    for (const fn of script.functions) {
      const count = fn.ranges[0]?.count ?? 0
      if (!count) continue
      const where = mapper.locate(file, fn.ranges[0]!.startOffset, fn.functionName)
      if (where.source.includes('src/perf/')) continue
      calls += count
      const key = `${where.name} ${where.source}:${where.line}`
      byFunction.set(key, (byFunction.get(key) ?? 0) + count)
    }
  }
  const sorted = [...byFunction].sort((a, b) => b[1] - a[1])
  return { calls, top: Object.fromEntries(sorted.slice(0, 40)), all: byFunction }
}

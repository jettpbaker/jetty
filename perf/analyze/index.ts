import * as Trace from '@paulirish/trace_engine'

// Turns one journey's trace into trace-summary.md, which an agent reads instead of 2 MB of
// JSON: hot functions, forced reflows, long animation frames, DevTools insights, and the
// Jetty and React tracks. Everything is source-mapped through the lab build's hidden maps.
import type { SourceMapper } from '../sourcemap'

type TraceEvent = {
  name: string
  cat?: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  id?: string
  args?: { data?: Record<string, unknown>; detail?: string }
}

type CallFrame = { functionName: string; url: string; lineNumber: number; columnNumber: number }

export type Loaf = {
  start: number
  duration: number
  blocking: number
  scripts: {
    invoker: string
    type: string
    url: string
    fn: string
    position: number
    duration: number
    forced: number
  }[]
}

// The engine expects a browser.
const browser = globalThis as { DOMRect?: unknown }
browser.DOMRect ??= class {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0
  ) {}
}

function where(mapper: SourceMapper, origin: string, frame: CallFrame) {
  if (!frame.url.startsWith(`${origin}/`))
    return frame.url ? `${frame.functionName || '(anonymous)'} ${frame.url}` : frame.functionName
  const file = new URL(frame.url).pathname
  const at = mapper.locateFrame(file, frame.lineNumber, frame.columnNumber, frame.functionName)
  return `${at.name} ${at.source}:${at.line}`
}

const ms = (value: number) => `${(value / 1000).toFixed(1)} ms`

// Bottom-up self time from the V8 sampling profile of the page's renderer main thread.
function selfTime(events: TraceEvent[], mapper: SourceMapper, origin: string) {
  type Profile = { nodes: Map<number, CallFrame>; samples: number[]; deltas: number[] }
  const profiles = new Map<string, Profile>()
  for (const event of events) {
    if (event.name !== 'ProfileChunk' || !event.id) continue
    const data = event.args?.data as {
      cpuProfile?: { nodes?: { id: number; callFrame: CallFrame }[]; samples?: number[] }
      timeDeltas?: number[]
    }
    const key = `${event.pid}:${event.id}`
    const profile: Profile = profiles.get(key) ?? { nodes: new Map(), samples: [], deltas: [] }
    for (const node of data.cpuProfile?.nodes ?? []) profile.nodes.set(node.id, node.callFrame)
    profile.samples.push(...(data.cpuProfile?.samples ?? []))
    profile.deltas.push(...(data.timeDeltas ?? []))
    profiles.set(key, profile)
  }
  const app = [...profiles.values()].find((profile) =>
    [...profile.nodes.values()].some((frame) => frame.url.startsWith(origin))
  )
  if (!app) return []
  const totals = new Map<string, number>()
  for (let i = 0; i < app.samples.length; i++) {
    const frame = app.nodes.get(app.samples[i]!)
    if (!frame || frame.functionName === '(idle)') continue
    const key = where(mapper, origin, frame)
    totals.set(key, (totals.get(key) ?? 0) + (app.deltas[i + 1] ?? 0))
  }
  return [...totals].sort((a, b) => b[1] - a[1])
}

export async function summarizeTrace(opts: {
  tracePath: string
  journey: string
  origin: string
  mapper: SourceMapper
  loafs: Loaf[]
}) {
  const raw = JSON.parse(await Bun.file(opts.tracePath).text())
  const events: TraceEvent[] = raw.traceEvents ?? raw
  const model = Trace.TraceModel.Model.createWithAllHandlers()
  await model.parse(events as never)
  const parsed = model.parsedTrace()
  if (!parsed) throw new Error('the trace engine could not parse the trace')
  const { mapper, origin } = opts
  const start = Math.min(...events.filter((event) => event.ts > 0).map((event) => event.ts))
  const lines = [`# Trace summary: ${opts.journey}`, '', `Trace: \`${opts.tracePath}\``, '']

  const hot = selfTime(events, mapper, origin)
  const total = hot.reduce((sum, [, time]) => sum + time, 0)
  lines.push(`## Top self time (${ms(total)} sampled, CPU throttled 4×)`, '')
  for (const [fn, time] of hot.slice(0, 15))
    lines.push(`- ${ms(time)} (${((time / total) * 100).toFixed(1)}%) \`${fn}\``)
  lines.push('')

  const insightSet = [...(parsed.insights?.values() ?? [])][0]
  const models = (insightSet?.model ?? {}) as Record<string, Record<string, unknown>>
  const reflow = models.ForcedReflow as
    | {
        aggregatedBottomUpData?: {
          bottomUpData: CallFrame | null
          totalTime: number
          relatedEvents: unknown[]
        }[]
        topLevelFunctionCallData?: { topLevelFunctionCall: CallFrame; totalReflowTime: number }
      }
    | undefined
  lines.push('## Forced reflows', '')
  const reflows = reflow?.aggregatedBottomUpData ?? []
  if (!reflows.length) lines.push('None.')
  for (const entry of reflows.slice(0, 10))
    lines.push(
      `- ${ms(entry.totalTime)} in ${entry.relatedEvents.length} reflow(s) from \`${
        entry.bottomUpData ? where(mapper, origin, entry.bottomUpData) : '[unattributed]'
      }\``
    )
  if (reflow?.topLevelFunctionCallData)
    lines.push(
      `- top-level caller: \`${where(mapper, origin, reflow.topLevelFunctionCallData.topLevelFunctionCall)}\` (${ms(reflow.topLevelFunctionCallData.totalReflowTime)} total)`
    )
  lines.push('')

  lines.push('## Long animation frames', '')
  if (!opts.loafs.length) lines.push('None.')
  for (const loaf of opts.loafs.slice(0, 10)) {
    lines.push(`- ${loaf.duration.toFixed(0)} ms frame, ${loaf.blocking.toFixed(0)} ms blocking`)
    for (const script of [...loaf.scripts].sort((a, b) => b.duration - a.duration).slice(0, 4)) {
      const file = script.url.startsWith(`${origin}/`) ? new URL(script.url).pathname : null
      const at =
        file && script.position >= 0 ? mapper.locate(file, script.position, script.fn) : null
      lines.push(
        `  - ${script.duration.toFixed(0)} ms ${script.type} \`${script.invoker}\`${
          at ? ` → \`${at.name} ${at.source}:${at.line}\`` : ''
        }${script.forced ? `, ${script.forced.toFixed(0)} ms forced style/layout` : ''}`
      )
    }
  }
  lines.push('')

  lines.push('## Insights', '')
  for (const [name, insight] of Object.entries(models)) {
    if (!interactionInsights.has(name)) continue
    if (insight.state !== 'fail' && insight.state !== 'informative') continue
    lines.push(
      `- **${String(insight.title ?? name)}** (${String(insight.state)})${insightDetail(name, insight)}`
    )
  }
  lines.push('')

  lines.push('## Jetty track', '')
  const timings = parsed.data.UserTimings
  const marks = [...timings.performanceMeasures, ...timings.performanceMarks]
    .map((event) => ({
      name: event.name,
      at: (event.ts - start) / 1000,
      dur: (event.dur ?? 0) / 1000,
    }))
    .sort((a, b) => a.at - b.at)
  if (!marks.length) lines.push('No performance marks or measures.')
  for (const mark of marks)
    lines.push(
      `- ${mark.at.toFixed(1)} ms \`${mark.name}\`${mark.dur ? ` (${mark.dur.toFixed(1)} ms)` : ''}`
    )
  lines.push('')

  const tracks = new Map<string, { count: number; time: number }>()
  for (const event of timings.timestampEvents) {
    const data = (
      event.args as {
        data?: { track?: string; trackGroup?: string; start?: number; end?: number; name?: string }
      }
    ).data
    if (!data?.track) continue
    const key = `${data.trackGroup ? `${data.trackGroup} / ` : ''}${data.track}`
    const entry = tracks.get(key) ?? { count: 0, time: 0 }
    entry.count++
    if (typeof data.start === 'number' && typeof data.end === 'number')
      entry.time += data.end - data.start
    tracks.set(key, entry)
  }
  lines.push('## React tracks (profiling build)', '')
  if (!tracks.size) lines.push('No React track entries.')
  for (const [track, entry] of tracks)
    lines.push(`- ${track}: ${entry.count} entries, ${ms(entry.time)}`)
  lines.push('')
  return lines.join('\n')
}

// The rest (LCP, caching, render-blocking, HTTP) are about page loads from a network.
const interactionInsights = new Set([
  'INPBreakdown',
  'CLSCulprits',
  'DOMSize',
  'ForcedReflow',
  'SlowCSSSelector',
  'DuplicatedJavaScript',
])

function insightDetail(name: string, insight: Record<string, unknown>) {
  if (name === 'DOMSize') {
    const stats = (
      insight.maxDOMStats as {
        args?: {
          data?: {
            maxChildren?: { numChildren: number; nodeName: string }
            maxDepth?: { depth: number }
          }
        }
      }
    )?.args?.data
    return stats
      ? `: deepest ${stats.maxDepth?.depth ?? '?'} levels; widest ${stats.maxChildren?.numChildren ?? '?'} children under \`${stats.maxChildren?.nodeName.slice(0, 60) ?? '?'}\``
      : ''
  }
  if (name === 'INPBreakdown') {
    const event = insight.longestInteractionEvent as { type?: string; dur?: number } | undefined
    return event ? `: longest interaction ${event.type} ${ms(event.dur ?? 0)}` : ''
  }
  if (name === 'SlowCSSSelector') {
    const top = insight.topSelectorElapsedMs as { selector?: string; elapsed?: number } | undefined
    return top?.selector
      ? `: slowest selector \`${top.selector}\``
      : `: ${String(insight.totalElapsedMs ?? '')} ms matching`
  }
  return ''
}

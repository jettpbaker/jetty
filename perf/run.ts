import { connect, type Client } from '@jetty/server/src/rpc-test-client'
import { appendFileSync, mkdirSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { join } from 'node:path'

import type { Loaf } from './analyze'

import { perfDir, prepareTree, startServer, type Server, type Tree } from './app'
import chrome from './chrome.json'
import {
  delta,
  emptySnapshot,
  instrument,
  snapshot,
  startCoverage,
  takeCoverage,
  type Counters,
} from './counters'
import { openPage, viewport, type Page } from './driver'
import { quiet, type Ctx, type Journey } from './journey'
import { journeyId, journeys as allJourneys } from './journeys'
import { cloneHome, goldenHome, type Golden } from './seed'
import { createSourceMapper, type SourceMapper } from './sourcemap'

export const cpuThrottle = 4

export type PerfRecord = {
  v: 1
  t: number
  sid: string
  k: string
  n: string
  d?: number
  jid?: string
  a?: { [key: string]: number | string | boolean }
}

export type Iteration = {
  journey: string
  case: string
  variant: string
  sha: string
  chrome: string
  iteration: number
  warmup: boolean
  counters: Counters
  wallMs: number
  wallSource: 'record' | 'lab' | 'none'
  settled: boolean
  phases?: Counters
  record?: PerfRecord
  top?: Counters
  // Every app function's call count; kept in memory for drift diagnosis, not written out.
  calls?: Map<string, number>
  loafs?: Loaf[]
  warning?: string
  error?: string
}

export type Variant = {
  label: string
  tree: Tree
  golden: Golden
  mapper: SourceMapper
  servers: Map<string, Promise<{ server: Server; rpc: Client }>>
  gh: 'replay' | 'record'
  // How long each journey took from input to settled last time, for ping alignment.
  spans: Map<string, number>
}

export function makeVariant(
  label: string,
  tree: Tree,
  golden: Golden,
  gh: Variant['gh'] = 'replay'
): Variant {
  return {
    label,
    tree,
    golden,
    mapper: createSourceMapper(join(tree.dir, 'client/dist')),
    servers: new Map(),
    gh,
    spans: new Map(),
  }
}

export type RunOptions = {
  n: number
  filter?: string
  // `sameAs` reuses another variant's build with its own servers: the A/A noise run.
  variants: { label: string; ref?: string; sameAs?: string }[]
  out: string
}

export function selectJourneys(filter?: string) {
  const picked = filter
    ? allJourneys.filter((journey) =>
        filter.split(',').some((part) => journeyId(journey) === part || journey.name === part)
      )
    : allJourneys
  if (picked.length === 0) throw new Error(`no journey matches ${filter}`)
  return picked
}

// Laptop hygiene: on battery the CPU clocks down, and a busy machine (other agents building)
// smears every wall-clock number.
export async function checkMachine() {
  const power = await new Response(Bun.spawn(['pmset', '-g', 'batt']).stdout).text()
  if (!power.includes("'AC Power'"))
    throw new Error('refusing to run on battery power; plug in (pmset -g batt)')
  const load = loadavg()[0]! / cpus().length
  if (load > 0.5)
    console.warn(
      `warning: CPU load is high (${loadavg()[0]!.toFixed(1)} on ${cpus().length} cores); wall-clock will be noisy, tier-1 counters are unaffected`
    )
  // Keep the machine awake for as long as this process lives.
  Bun.spawn(['caffeinate', '-dimsu', '-w', String(process.pid)], { stdout: 'ignore' })
}

export async function prepareVariant(
  label: string,
  ref?: string,
  opts: { profiling?: boolean } = {}
): Promise<Variant> {
  console.log(`preparing ${label}${ref ? ` (${ref})` : ' (working tree)'}…`)
  const tree = await prepareTree(label, ref, opts)
  try {
    return makeVariant(label, tree, await goldenHome(tree))
  } catch (error) {
    await tree.dispose()
    throw error
  }
}

function serverFor(variant: Variant, env: { [key: string]: string } = {}, out: string) {
  const key = JSON.stringify(env)
  let entry = variant.servers.get(key)
  if (!entry) {
    entry = (async () => {
      const name = `${variant.label}-${variant.servers.size}`
      const home = join(variant.tree.dir, '..', `${variant.tree.dir.split('/').pop()}-home-${name}`)
      await cloneHome(variant.golden, home)
      const server = await startServer({
        tree: variant.tree,
        home,
        log: join(out, `server-${name}.log`),
        gh: { mode: variant.gh, misses: join(out, 'gh-misses.ndjson') },
        env,
      })
      return { server, rpc: await connect(server.port) }
    })()
    variant.servers.set(key, entry)
  }
  return entry
}

export async function disposeVariant(variant: Variant) {
  for (const entry of variant.servers.values()) {
    const { server, rpc } = await entry.catch(() => ({ server: null, rpc: null }))
    await rpc?.close().catch(() => undefined)
    await server?.stop()
    if (server) await Bun.spawn(['rm', '-rf', server.home]).exited
  }
  await variant.tree.dispose()
}

async function preparePage(origin: string) {
  const page = await openPage()
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await page.cdp('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
  await page.cdp('Network.enable')
  // Nothing leaves the machine: avatars and other remote media would make runs depend on
  // the network.
  await page.cdp('Network.setBlockedURLs', { urls: ['https://*', 'http://*.com/*'] })
  await instrument(page)
  // A same-origin blank page (the server's 404), so storage can be cleared and the app
  // navigation stays in one renderer.
  await page.navigate(`${origin}/attachments/perf-lab`)
  await page.cdp('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
  return page
}

async function waitForJourney(page: Page, journey: Journey, ctx: Ctx) {
  const started = Date.now()
  const others: PerfRecord[] = []
  let doneAt = 0
  for (;;) {
    // With the in-app module, take() is what's polled; its calls are excluded from the counts.
    const state = await page
      .evaluate<{ module: boolean; records: PerfRecord[] }>(
        `(() => {
          const perf = window.__jettyPerf
          return { module: !!perf, records: perf ? perf.take() : [] }
        })()`
      )
      .catch(() => null)
    for (const record of state?.records ?? []) {
      if (record.k === 'journey' && record.n === journey.name) return { record, others }
      others.push(record)
    }
    // Without the module the DOM condition ends the journey. With it, the condition is only
    // a fallback for a record that never comes, reported rather than waited on forever.
    if (state && (!state.module || Date.now() - started > 300)) {
      const done = await page.evaluate<boolean>(`!!(${journey.done(ctx)})`).catch(() => false)
      if (done && !state.module) return { record: null, others }
      if (done) doneAt ||= Date.now()
      if (doneAt && Date.now() - doneAt > 1000) return { record: null, others, missing: true }
    }
    if (Date.now() - started > 20_000) throw new Error(`${journeyId(journey)} did not finish`)
    await Bun.sleep(state?.module ? 20 : 50)
  }
}

// The app's RPC socket pings every 5 s and handling the pong is app work. Starting a journey
// just after a pong, when the journey fits before the next one, keeps it out of the counts.
const pingMs = 5000

function watchSocket(page: Page) {
  let last = Date.now()
  page.on<{ url: string }>('Network.webSocketCreated', (data) => {
    if (data.url.includes('/ws')) last = Date.now()
  })
  page.on<{ response: { payloadData: string } }>('Network.webSocketFrameReceived', (data) => {
    if (data.response.payloadData.includes('"Pong"')) last = Date.now()
  })
  return {
    async clear(expectedMs: number) {
      const deadline = Date.now() + pingMs + 1000
      while (Date.now() - last + expectedMs > pingMs - 300 && Date.now() < deadline)
        await Bun.sleep(20)
    },
  }
}

async function waitSettled(page: Page, expression: string) {
  const deadline = Date.now() + 60_000
  while (!(await page.evaluate<boolean>(`!!(${expression})`).catch(() => false))) {
    if (Date.now() > deadline) throw new Error('journey never settled')
    await Bun.sleep(50)
  }
}

export async function iterate(
  variant: Variant,
  journey: Journey,
  opts: { iteration: number; warmup: boolean; out: string; trace?: string }
): Promise<Iteration> {
  const { server, rpc } = await serverFor(variant, journey.env, opts.out)
  const base = {
    journey: journey.name,
    case: journey.case,
    variant: variant.label,
    sha: variant.tree.sha,
    chrome: chrome.version,
    iteration: opts.iteration,
    warmup: opts.warmup,
  }
  const page = await preparePage(server.origin)
  const socket = watchSocket(page)
  const ctx: Ctx = { page, origin: server.origin, fixtures: variant.golden.fixtures, rpc, vars: {} }
  const id = journeyId(journey)
  try {
    await startCoverage(page)
    await journey.setup(ctx)
    await quiet(page)
    if (!journey.navigates) await socket.clear(variant.spans.get(id) ?? 2000)
    await page.evaluate('window.__jettyPerf?.take(), 0')
    const before = journey.navigates ? emptySnapshot : await snapshot(page)
    await takeCoverage(page, server.origin, variant.mapper)
    const tracing = opts.trace ? await startTrace(page) : null
    const actAt = journey.navigates ? 0 : await page.evaluate<number>('performance.now()')
    const started = performance.now()
    await journey.act(ctx)
    const finished = await waitForJourney(page, journey, ctx)
    const labWall = performance.now() - started
    if (journey.settled) await waitSettled(page, journey.settled(ctx))
    const settled = await quiet(page)
    variant.spans.set(id, performance.now() - started)
    const after = await snapshot(page)
    const coverage = await takeCoverage(page, server.origin, variant.mapper)
    const loafs = tracing
      ? (await page.evaluate<Loaf[]>('window.__perfLab.loafs')).filter(
          (loaf) => loaf.start + loaf.duration >= actAt
        )
      : undefined
    if (tracing) await tracing.stop(opts.trace!)
    const { record } = finished
    const counters = { ...delta(before, after), jsCalls: coverage.calls }
    const phases: Counters = {}
    for (const phase of ['input', 'local', 'rendered', 'painted', 'caughtUp'])
      if (typeof record?.a?.[phase] === 'number') phases[phase] = record.a[phase]
    return {
      ...base,
      counters,
      // A page with the module but no record for this journey gets no wall-clock sample: the
      // lab's own timing isn't the same measurement.
      wallMs: finished.missing ? NaN : Math.round((record?.d ?? labWall) * 10) / 10,
      wallSource: record?.d !== undefined ? 'record' : finished.missing ? 'none' : 'lab',
      settled,
      ...(record ? { phases, record } : {}),
      top: coverage.top,
      calls: coverage.all,
      ...(loafs ? { loafs } : {}),
      ...(finished.missing
        ? { warning: 'the page sent no journey record: counters but no wall-clock' }
        : settled
          ? {}
          : { warning: 'the page never went quiet, so the window closed on the timeout' }),
    }
  } catch (error) {
    return {
      ...base,
      counters: {},
      wallMs: NaN,
      wallSource: 'lab',
      settled: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await page.close()
    await journey.cleanup?.(ctx).catch(() => undefined)
  }
}

async function startTrace(page: Page) {
  let stream: string | undefined
  const off = page.on<{ stream: string }>('Tracing.tracingComplete', (data) => {
    stream = data.stream
  })
  await page.cdp('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: {
      includedCategories: [
        '-*',
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
        'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-devtools.timeline.invalidationTracking',
        'disabled-by-default-v8.cpu_profiler',
        'v8.execute',
        'v8',
        'blink.user_timing',
        'blink.console',
        'loading',
        'latencyInfo',
        'toplevel',
      ],
    },
  })
  return {
    async stop(path: string) {
      await page.cdp('Tracing.end')
      while (!stream) await Bun.sleep(20)
      off()
      const parts: string[] = []
      for (;;) {
        const chunk = await page.cdp<{ data: string; eof: boolean; base64Encoded?: boolean }>(
          'IO.read',
          { handle: stream, size: 1 << 20 }
        )
        parts.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data)
        if (chunk.eof) break
      }
      await page.cdp('IO.close', { handle: stream })
      await Bun.write(path, parts.join(''))
    },
  }
}

export function outDir() {
  const dir = join(perfDir, 'out', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(dir, { recursive: true })
  return dir
}

// Every journey runs a discarded warm-up, then n measured iterations. With two variants the
// order alternates each iteration (A B, B A, …) so drift hits both equally.
export async function runJourneys(opts: RunOptions) {
  const journeys = selectJourneys(opts.filter)
  const variants: Variant[] = []
  const results: Iteration[] = []
  const runs = join(opts.out, 'runs.ndjson')
  try {
    for (const spec of opts.variants) {
      const twin = variants.find((variant) => variant.label === spec.sameAs)
      variants.push(
        twin
          ? { ...twin, label: spec.label, servers: new Map(), spans: new Map() }
          : await prepareVariant(spec.label, spec.ref)
      )
    }
    for (const journey of journeys) {
      for (let i = 0; i <= opts.n; i++) {
        const order = i % 2 === 0 ? variants : [...variants].reverse()
        for (const variant of order) {
          const result = await iterate(variant, journey, {
            iteration: i,
            warmup: i === 0,
            out: opts.out,
          })
          results.push(result)
          const { calls: _calls, ...line } = result
          appendFileSync(runs, `${JSON.stringify(line)}\n`)
          const label = `${journeyId(journey)} ${variant.label} #${i}${i === 0 ? ' (warm-up)' : ''}`
          console.log(
            result.error
              ? `${label}: ERROR ${result.error}`
              : `${label}: ${result.wallMs} ms (${result.wallSource}) commits=${result.counters.commits ?? '-'} calls=${result.counters.jsCalls} layouts=${result.counters.layouts} recalcs=${result.counters.styleRecalcs} mutations=${result.counters.mutations}`
          )
        }
      }
    }
  } finally {
    for (const variant of variants) await disposeVariant(variant)
  }
  return { results, journeys, variants: opts.variants.map((v) => v.label) }
}

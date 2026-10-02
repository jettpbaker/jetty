import { cpus, loadavg } from 'node:os'
import { join } from 'node:path'

import { summarizeTrace } from './analyze'
import { prepareTree } from './app'
import { tier2 } from './counters'
import { journeyId } from './journeys'
import { recordGh } from './record-gh'
import {
  baselinePath,
  frameBatched,
  budgetsPath,
  readJson,
  renderReport,
  summarize,
  writeJson,
  type Baseline,
  type Budgets,
} from './report'
import {
  checkMachine,
  disposeVariant,
  iterate,
  outDir,
  prepareVariant,
  runJourneys,
  selectJourneys,
  type RunOptions,
} from './run'
import { goldenHome } from './seed'
import { median, medianDiffCI, round } from './stats'

const usage = `bun perf <command>

  run [-n 10] [--journey <ids>] [--compare <ref>] [--save]
                   measure the working tree; --save writes perf/baseline.json
  compare <ref>    A/B against a git ref, interleaved (same flags as run)
  noise            A/A run of one build; writes the wall-clock noise floor to baseline.json
  ratchet          lower perf/budgets.json ceilings to the baseline
  analyze <id>     trace one journey (e.g. thread.switch/long) → trace-summary.md
  record-gh        re-record the fake gh's GitHub fixtures (needs gh auth)
  seed [--force]   build (or rebuild) the golden JETTY_HOME

<ids> is a comma list of journeys (thread.switch) or cases (thread.switch/long).`

const [command = 'help', ...rest] = Bun.argv.slice(2)

function flag(name: string) {
  const index = rest.indexOf(name)
  return index >= 0 ? rest[index + 1] : undefined
}

function loadNow() {
  return `${loadavg()[0]!.toFixed(1)} on ${cpus().length} cores`
}

async function measure(
  mode: 'run' | 'compare' | 'noise',
  variants: RunOptions['variants'],
  title: string
) {
  await checkMachine()
  const out = outDir()
  const load = loadNow()
  const { results } = await runJourneys({
    n: Number(flag('-n') ?? 10),
    filter: flag('--journey'),
    variants,
    out,
  })
  const baseline = await readJson<Baseline>(baselinePath)
  const misses = (
    await Bun.file(join(out, 'gh-misses.ndjson'))
      .text()
      .catch(() => '')
  )
    .split('\n')
    .filter(Boolean)
  const report = renderReport({
    notes: misses.length
      ? [
          `**${misses.length} gh calls had no recorded fixture** (see gh-misses.ndjson), so PR journeys saw GitHub failures. Re-record with \`bun perf record-gh\`.`,
        ]
      : [],
    title,
    results,
    baseline,
    budgets: await readJson<Budgets>(budgetsPath),
    mode,
    variants: variants.map((variant) => variant.label),
    load,
  })
  await Bun.write(join(out, 'report.md'), report)
  console.log(`\n${report}\n\n${join(out, 'report.md')}`)
  return { results, baseline }
}

switch (command) {
  case 'run': {
    const ref = flag('--compare')
    if (ref) {
      await measure(
        'compare',
        [{ label: 'base', ref }, { label: 'head' }],
        `Perf compare: working tree vs ${ref}`
      )
      break
    }
    const { results, baseline } = await measure('run', [{ label: 'head' }], 'Perf run')
    if (rest.includes('--save')) {
      const journeys: Baseline['journeys'] = {}
      for (const id of new Set(results.map((run) => `${run.journey}/${run.case}`))) {
        const runs = results.filter((run) => `${run.journey}/${run.case}` === id)
        journeys[id] = {
          ...summarize({ id, variant: 'head', runs: runs.filter((run) => !run.warmup) }),
          ...(baseline?.journeys[id]?.noiseMs !== undefined
            ? { noiseMs: baseline.journeys[id].noiseMs }
            : {}),
        }
      }
      await writeJson(baselinePath, {
        createdAt: new Date().toISOString(),
        sha: results[0]?.sha ?? '',
        chrome: results[0]?.chrome ?? '',
        n: Number(flag('-n') ?? 10),
        journeys: { ...baseline?.journeys, ...journeys },
      } satisfies Baseline)
      console.log(`saved ${baselinePath}`)
    }
    break
  }
  case 'compare': {
    const ref = rest[0]
    if (!ref || ref.startsWith('-')) throw new Error('usage: bun perf compare <git-ref>')
    await measure(
      'compare',
      [{ label: 'base', ref }, { label: 'head' }],
      `Perf compare: working tree vs ${ref}`
    )
    break
  }
  case 'noise': {
    const { results } = await measure(
      'noise',
      [{ label: 'A' }, { label: 'A2', sameAs: 'A' }],
      'Perf noise floor (A/A)'
    )
    const baseline = (await readJson<Baseline>(baselinePath)) ?? {
      createdAt: new Date().toISOString(),
      sha: results[0]?.sha ?? '',
      chrome: results[0]?.chrome ?? '',
      n: 0,
      journeys: {},
    }
    for (const id of new Set(results.map((run) => `${run.journey}/${run.case}`))) {
      const wall = (variant: string) =>
        results
          .filter(
            (run) =>
              `${run.journey}/${run.case}` === id &&
              run.variant === variant &&
              !run.warmup &&
              !run.error
          )
          .map((run) => run.wallMs)
      const [lo, hi] = medianDiffCI(wall('A'), wall('A2'))
      const entry = baseline.journeys[id]
      const noiseMs = round(Math.max(Math.abs(lo), Math.abs(hi)))
      baseline.journeys[id] = entry
        ? { ...entry, noiseMs }
        : { wallMs: round(median(wall('A'))), wallCI: [lo, hi], noiseMs, counters: {} }
    }
    await writeJson(baselinePath, baseline)
    console.log(`noise floors saved to ${baselinePath}`)
    break
  }
  case 'ratchet': {
    const baseline = await readJson<Baseline>(baselinePath)
    if (!baseline) throw new Error('no perf/baseline.json yet: run `bun perf run --save` first')
    const budgets = (await readJson<Budgets>(budgetsPath)) ?? {}
    const changes: string[] = []
    for (const [id, entry] of Object.entries(baseline.journeys)) {
      const budget = (budgets[id] ??= {})
      // Exact counts get the count as their ceiling; frame-batched ones, which jitter by a pass
      // or two, get 10%; wall-clock gets the noise floor.
      const proposed: Record<string, number> = {}
      for (const [name, value] of Object.entries(entry.counters))
        if (!(tier2 as readonly string[]).includes(name))
          proposed[name] = Math.ceil(frameBatched.has(name) ? value * 1.1 : value)
      proposed.wallMs = round(entry.wallMs + (entry.noiseMs ?? 0))
      for (const [name, value] of Object.entries(proposed)) {
        const ceiling = budget[name]
        const margin = name === 'wallMs' ? (entry.noiseMs ?? 0) : 0
        if (ceiling === undefined || value < ceiling - margin) {
          changes.push(`${id} ${name}: ${ceiling ?? 'new'} → ${value}`)
          budget[name] = value
        }
      }
    }
    await writeJson(budgetsPath, budgets)
    console.log(changes.length ? changes.join('\n') : 'no ceiling moved')
    break
  }
  case 'analyze': {
    const id = rest[0]
    if (!id || !id.includes('/'))
      throw new Error('usage: bun perf analyze <journey/case>, e.g. thread.switch/long')
    await checkMachine()
    const [journey] = selectJourneys(id)
    const out = outDir()
    const variant = await prepareVariant('head', undefined, { profiling: true })
    try {
      await iterate(variant, journey!, { iteration: 0, warmup: true, out })
      const tracePath = join(out, 'trace.json')
      const result = await iterate(variant, journey!, {
        iteration: 1,
        warmup: false,
        out,
        trace: tracePath,
      })
      if (result.error) throw new Error(result.error)
      const { server } = await variant.servers.values().next().value!
      const summary = await summarizeTrace({
        tracePath,
        journey: journeyId(journey!),
        origin: server.origin,
        mapper: variant.mapper,
        loafs: result.loafs ?? [],
      })
      await Bun.write(join(out, 'trace-summary.md'), summary)
      console.log(`${summary}\n\n${join(out, 'trace-summary.md')}`)
    } finally {
      await disposeVariant(variant)
    }
    break
  }
  case 'record-gh':
    await recordGh(outDir())
    break
  case 'seed': {
    const tree = await prepareTree('seed')
    try {
      const golden = await goldenHome(tree, { force: rest.includes('--force') })
      console.log(golden.dir)
    } finally {
      await tree.dispose()
    }
    break
  }
  default:
    console.log(usage)
}
process.exit(0)

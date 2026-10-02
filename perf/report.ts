import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { Iteration } from './run'

import { format, perfDir } from './app'
import chrome from './chrome.json'
import { tier1, tier2 } from './counters'
import { median, medianCI, medianDiffCI, round } from './stats'

export const baselinePath = join(perfDir, 'baseline.json')
export const budgetsPath = join(perfDir, 'budgets.json')

export type BaselineEntry = {
  wallMs: number
  wallCI: [number, number]
  noiseMs?: number
  counters: Record<string, number>
}
export type Baseline = {
  createdAt: string
  sha: string
  chrome: string
  n: number
  journeys: Record<string, BaselineEntry>
}
export type Budgets = Record<string, Record<string, number>>

export async function readJson<T>(path: string): Promise<T | null> {
  return existsSync(path) ? ((await Bun.file(path).json()) as T) : null
}

export async function writeJson(path: string, value: unknown) {
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
  await format(path)
}

type Group = { id: string; variant: string; runs: Iteration[] }

function groups(results: Iteration[]) {
  const map = new Map<string, Group>()
  for (const run of results) {
    if (run.warmup) continue
    const id = `${run.journey}/${run.case}`
    const key = `${id}\0${run.variant}`
    const group = map.get(key) ?? { id, variant: run.variant, runs: [] }
    group.runs.push(run)
    map.set(key, group)
  }
  return [...map.values()]
}

function ok(runs: Iteration[]) {
  return runs.filter((run) => !run.error)
}

function values(runs: Iteration[], counter: string) {
  return ok(runs)
    .map((run) => run.counters[counter])
    .filter((value): value is number => typeof value === 'number')
}

function walls(runs: Iteration[]) {
  return ok(runs)
    .map((run) => run.wallMs)
    .filter((wall) => Number.isFinite(wall))
}

// Every counter that appeared in any run, tier 1 first, then per-region shifts.
function counterNames(runs: Iteration[]) {
  const seen = new Set(runs.flatMap((run) => Object.keys(run.counters)))
  const regions = [...seen].filter((name) => name.startsWith('shifts.')).sort()
  return [...tier1.filter((name) => seen.has(name)), ...regions]
}

export function summarize(group: Group): BaselineEntry {
  const counters: Record<string, number> = {}
  for (const name of [...counterNames(group.runs), ...tier2])
    if (values(group.runs, name).length) counters[name] = median(values(group.runs, name))
  const wall = walls(group.runs)
  return {
    wallMs: round(median(wall)),
    wallCI: medianCI(wall).map((value) => round(value)) as [number, number],
    counters,
  }
}

// Layout and style passes and long frames are counted per rendered frame, and how work lands
// in frames is timing: macOS Chrome can't pin frame timing (BeginFrame control is Linux-only),
// so these jitter by a pass or two. Every other tier-1 counter should be exact.
export const frameBatched = new Set(['layouts', 'styleRecalcs', 'loafCount'])

function range(runs: Iteration[], name: string) {
  const list = values(runs, name)
  return { min: Math.min(...list), max: Math.max(...list), n: list.length }
}

// A tier-1 counter that differs between iterations of the same build is a bug or a flake
// source (timers, animations, time-sliced rendering), not noise to average away.
function nondeterminism(group: Group) {
  const exact: string[] = []
  const frame: string[] = []
  for (const name of counterNames(group.runs)) {
    const { min, max, n } = range(group.runs, name)
    if (n < 2 || min === max) continue
    ;(frameBatched.has(name) ? frame : exact).push(`${name} ${fmt(min)}–${fmt(max)}`)
  }
  return { exact, frame }
}

// The functions whose call counts moved between iterations: where to look for drift.
function driftingFunctions(group: Group) {
  const runs = ok(group.runs).filter((run) => run.calls)
  if (runs.length < 2) return []
  const keys = new Set(runs.flatMap((run) => [...run.calls!.keys()]))
  const out: { fn: string; min: number; max: number }[] = []
  for (const key of keys) {
    const counts = runs.map((run) => run.calls!.get(key) ?? 0)
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    if (min !== max) out.push({ fn: key, min, max })
  }
  return out.sort((a, b) => b.max - b.min - (a.max - a.min)).slice(0, 5)
}

function fmt(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return '–'
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : round(value).toLocaleString('en-US')
}

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${fmt(value)}`
}

function table(header: string[], rows: string[][]) {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

const columns = [
  ['commits', 'commits'],
  ['jsCalls', 'calls'],
  ['layouts', 'layouts'],
  ['styleRecalcs', 'recalcs'],
  ['mutations', 'mutations'],
  ['domNodes', 'nodes'],
  ['wsMsgs', 'ws msgs'],
  ['wsBytes', 'ws bytes'],
  ['shifts', 'shifts'],
  ['loafCount', 'LoAF'],
] as const

export function renderReport(opts: {
  title: string
  results: Iteration[]
  baseline: Baseline | null
  budgets: Budgets | null
  mode: 'run' | 'compare' | 'noise'
  variants: string[]
  load: string
  notes?: string[]
}) {
  const all = groups(opts.results)
  const lines: string[] = [
    `# ${opts.title}`,
    '',
    `- builds: ${[...new Set(opts.results.map((run) => `${run.variant} ${run.sha}`))].join(', ')}`,
    `- Chrome for Testing ${chrome.version}, 4× CPU throttle, 1440×900, n = ${
      all[0] ? all[0].runs.length : 0
    } per journey after one warm-up${opts.variants.length > 1 ? ', interleaved' : ''}`,
    `- machine load at start: ${opts.load}`,
    `- wall-clock: ${wallSources(opts.results)}`,
    '',
    ...(opts.notes ?? []).flatMap((note) => [`> ${note}`, '']),
  ]

  const drift: string[] = []
  const jitter: string[] = []
  for (const group of all) {
    const { exact, frame } = nondeterminism(group)
    if (exact.length) {
      drift.push(`- **${group.id}** (${group.variant}): ${exact.join(', ')}`)
      for (const fn of driftingFunctions(group))
        drift.push(`  - \`${fn.fn}\` ${fmt(fn.min)}–${fmt(fn.max)} calls`)
    }
    if (frame.length) jitter.push(`- ${group.id} (${group.variant}): ${frame.join(', ')}`)
  }
  const errors = opts.results.filter((run) => run.error)
  const warnings = new Map<string, number>()
  for (const run of opts.results)
    if (run.warning && !run.warmup) {
      const key = `${run.journey}/${run.case} (${run.variant}): ${run.warning}`
      warnings.set(key, (warnings.get(key) ?? 0) + 1)
    }

  if (opts.mode === 'run') {
    const header = ['journey', 'wall ms (95% CI)', ...columns.map(([, label]) => label)]
    if (opts.baseline) header.splice(2, 0, 'Δ wall vs baseline')
    const rows = all.map((group) => {
      const summary = summarize(group)
      const base = opts.baseline?.journeys[group.id]
      const row = [
        `\`${group.id}\``,
        `${fmt(summary.wallMs)} (${fmt(summary.wallCI[0])}–${fmt(summary.wallCI[1])})`,
        ...columns.map(([name]) => {
          const value = summary.counters[name]
          const was = base?.counters[name]
          return value !== undefined && was !== undefined && value !== was
            ? `${fmt(value)} (${signed(value - was)})`
            : fmt(value)
        }),
      ]
      if (opts.baseline)
        row.splice(
          2,
          0,
          base ? wallVerdict(summary.wallMs - base.wallMs, base.noiseMs) : 'no baseline'
        )
      return row
    })
    lines.push('## Journeys', '', table(header, rows), '')
  }

  if (opts.mode === 'compare' || opts.mode === 'noise') {
    const [a, b] = opts.variants as [string, string]
    lines.push(`## ${b} vs ${a}`, '')
    const ids = [...new Set(all.map((group) => group.id))]
    const rows: string[][] = []
    const floors: Record<string, number> = {}
    for (const id of ids) {
      const ga = all.find((group) => group.id === id && group.variant === a)
      const gb = all.find((group) => group.id === id && group.variant === b)
      if (!ga || !gb) continue
      const [lo, hi] = medianDiffCI(walls(ga.runs), walls(gb.runs))
      const diff = median(walls(gb.runs)) - median(walls(ga.runs))
      floors[id] = round(Math.max(Math.abs(lo), Math.abs(hi)))
      const noise = opts.baseline?.journeys[id]?.noiseMs
      // A counter moved when the two builds' ranges don't overlap; overlapping medians that
      // differ are jitter and get a ~.
      const moved = columns
        .map(([name, label]) => {
          const ra = range(ga.runs, name)
          const rb = range(gb.runs, name)
          const va = median(values(ga.runs, name))
          const vb = median(values(gb.runs, name))
          if (Number.isNaN(va) || Number.isNaN(vb) || va === vb) return null
          const overlap = rb.min <= ra.max && ra.min <= rb.max
          return `${overlap ? '~' : ''}${label} ${fmt(va)} → ${fmt(vb)} (${signed(vb - va)})`
        })
        .filter(Boolean)
      rows.push([
        `\`${id}\``,
        `${fmt(median(walls(ga.runs)))} → ${fmt(median(walls(gb.runs)))}`,
        `${signed(round(diff))} (${signed(round(lo))} to ${signed(round(hi))})`,
        opts.mode === 'noise' ? `±${fmt(floors[id])}` : ciVerdict(diff, lo, hi, noise),
        moved.length ? moved.join('<br>') : 'identical',
      ])
    }
    lines.push(
      table(
        [
          'journey',
          'wall median ms',
          'Δ median (95% CI)',
          opts.mode === 'noise' ? 'noise floor' : 'verdict',
          'tier-1 counters',
        ],
        rows
      ),
      ''
    )
    if (opts.mode === 'noise')
      lines.push(
        'The noise floor is the larger end of the A/A 95% CI of the median difference. A wall-clock change counts only when its CI excludes zero and it exceeds the floor. Tier-1 counters should read "identical".',
        ''
      )
  }

  lines.push('## Nondeterminism', '')
  lines.push(
    drift.length
      ? [
          '**Exact tier-1 counters varied between iterations of the same build.** That is a bug or a flake source (timers, async results racing a render, time-sliced rendering), not noise: find it before trusting these journeys. The functions whose call counts moved:',
          '',
          ...drift,
        ].join('\n')
      : 'Every exact tier-1 counter was identical across iterations.',
    ''
  )
  if (jitter.length)
    lines.push(
      'Frame-batched counters (layouts, recalcs, LoAF) jittered, as they do on macOS where frame timing cannot be pinned; compare their ranges, not single values:',
      '',
      ...jitter,
      ''
    )

  if (warnings.size) {
    lines.push('## Warnings', '')
    for (const [warning, count] of warnings)
      lines.push(`- ${warning}, in ${count} iteration(s); those have counters but no wall-clock`)
    lines.push('')
  }

  if (errors.length) {
    lines.push('## Errors', '')
    for (const run of errors)
      lines.push(`- ${run.journey}/${run.case} ${run.variant} #${run.iteration}: ${run.error}`)
    lines.push('')
  }

  if (opts.budgets && opts.mode === 'run') {
    const over: string[] = []
    for (const group of all) {
      const budget = opts.budgets[group.id]
      if (!budget) continue
      const summary = summarize(group)
      for (const [name, ceiling] of Object.entries(budget)) {
        const value = name === 'wallMs' ? summary.wallMs : summary.counters[name]
        if (value !== undefined && value > ceiling)
          over.push(`- \`${group.id}\` ${name} ${fmt(value)} > ${fmt(ceiling)}`)
      }
    }
    lines.push(
      '## Budgets (report-only)',
      '',
      over.length ? over.join('\n') : 'All within budget.',
      ''
    )
  }

  lines.push('## Details', '')
  for (const group of all) {
    const runs = ok(group.runs)
    if (!runs.length) continue
    lines.push(`### ${group.id} (${group.variant})`, '')
    const phases = new Set(runs.flatMap((run) => Object.keys(run.phases ?? {})))
    if (phases.size)
      lines.push(
        `- phases (median ms from input): ${[...phases]
          .map(
            (phase) =>
              `${phase} ${fmt(median(runs.map((run) => run.phases?.[phase] ?? NaN).filter((v) => !Number.isNaN(v))))}`
          )
          .join(', ')}`
      )
    lines.push(
      `- tier 2 (median): ${tier2
        .filter((name) => values(runs, name).length)
        .map((name) => `${name} ${fmt(median(values(runs, name)))}`)
        .join(', ')}`
    )
    const regions = counterNames(runs).filter((name) => name.startsWith('shifts.'))
    if (regions.length)
      lines.push(
        `- layout shifts by region: ${regions.map((name) => `${name.slice(7)} ${fmt(median(values(runs, name)))}`).join(', ')}`
      )
    const top = runs.at(-1)?.top
    if (top)
      lines.push(
        '- most-called functions (last iteration):',
        ...Object.entries(top)
          .slice(0, 8)
          .map(([fn, count]) => `  - ${fmt(count)} \`${fn}\``)
      )
    lines.push('')
  }
  return lines.join('\n')
}

function wallSources(results: Iteration[]) {
  const by = new Map<string, Set<string>>()
  for (const run of results)
    if (!run.error) by.set(run.variant, (by.get(run.variant) ?? new Set()).add(run.wallSource))
  const describe = (sources: Set<string>) =>
    sources.has('record')
      ? 'the journey record (input → painted)'
      : 'lab-measured (input → DOM condition); the page sent no records'
  const kinds = new Set([...by.values()].map(describe))
  if (kinds.size <= 1) return [...kinds][0] ?? 'none'
  return `**differs between builds** (${[...by].map(([variant, sources]) => `${variant}: ${describe(sources)}`).join('; ')}), so compare counters, not wall-clock`
}

function wallVerdict(diff: number, noise?: number) {
  if (noise === undefined) return `${signed(round(diff))} ms (no noise floor yet)`
  return Math.abs(diff) <= noise
    ? `${signed(round(diff))} ms (within ±${fmt(noise)})`
    : `**${signed(round(diff))} ms**`
}

function ciVerdict(diff: number, lo: number, hi: number, noise = 0) {
  if (lo > 0 && diff > noise) return '**slower**'
  if (hi < 0 && -diff > noise) return '**faster**'
  return 'within noise'
}

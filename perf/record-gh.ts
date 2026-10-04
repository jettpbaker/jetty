// Re-records the fake gh's fixtures from the real GitHub: seeds a home and runs every journey
// once, then visits each fixture PR's overview and diff, with perf/bin/gh in record mode.
// Whatever GitHub queries the server makes today are what gets captured.
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { format, perfDir, prepareTree } from './app'
import { click, hasText, open, quiet, type Ctx } from './journey'
import { journeyId, journeys } from './journeys'
import { disposeVariant, iterate, makeVariant, type Variant } from './run'
import { prNumbers, prRepo, seedHome } from './seed'

export async function recordGh(out: string) {
  const fixtures = join(perfDir, 'fixtures/gh')
  for (const file of readdirSync(fixtures)) if (file.endsWith('.json')) rmSync(join(fixtures, file))
  const tree = await prepareTree('record')
  const dir = join(tmpdir(), 'jetty-perf', `record-home-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  let variant: Variant | undefined
  try {
    const seeded = await seedHome({ tree, dir, gh: { mode: 'record' } })
    variant = makeVariant(
      'record',
      tree,
      { dir, home: join(dir, 'home'), fixtures: seeded },
      'record'
    )
    for (const journey of journeys) {
      const result = await iterate(variant, journey, { iteration: 0, warmup: true, out })
      if (result.error) throw new Error(`${journeyId(journey)}: ${result.error}`)
      console.log(`${journeyId(journey)}: ${result.error ?? 'recorded'}`)
    }
    const pr = journeys.find((journey) => journey.name === 'pr.diff')!
    for (const number of [...prNumbers, 5]) {
      // Borrow a journey's page setup, then walk the PR's tabs.
      const result = await iterate(
        variant,
        {
          ...pr,
          case: `record-${number}`,
          async setup(ctx: Ctx) {
            await open(ctx, `/pull-requests/${prRepo}/${number}`, hasText('Activity'))
          },
          async act(ctx: Ctx) {
            await click(ctx.page, diffTab, 'the Diff tab')
            await quiet(ctx.page, 1500)
            // A focused PR view refreshes every 30 s (polled on a 5 s tick), and a second
            // refresh in one server revalidates its REST reads with ETags: different gh calls.
            // The 30 s linked-PR change query lands in the same wait.
            if (number === prNumbers[0]) await Bun.sleep(40_000)
          },
          done: () => 'true',
        },
        { iteration: 0, warmup: true, out }
      )
      if (result.error) throw new Error(`PR #${number}: ${result.error}`)
      console.log(`PR #${number}: recorded`)
    }
  } finally {
    await (variant ? disposeVariant(variant) : tree.dispose())
    rmSync(dir, { recursive: true, force: true })
  }
  await format(fixtures)
  console.log(`${readdirSync(fixtures).length} fixtures in ${fixtures}`)
}

const diffTab = `[...document.querySelectorAll('nav[aria-label="Pull request view"] button')].find((tab) => tab.textContent.trim() === 'Diff')`

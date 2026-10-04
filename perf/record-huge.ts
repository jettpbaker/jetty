import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { hugeFixtures, hugeManifest, hugeRef } from './huge'
import { hugeJourneys } from './journeys/pr-huge'
import { disposeVariant, iterate, prepareVariant } from './run'

export async function recordHuge(out: string) {
  mkdirSync(hugeFixtures, { recursive: true })
  rmSync(hugeManifest, { force: true })
  const variant = await prepareVariant('huge-record')
  variant.gh = 'record'
  try {
    for (const journey of hugeJourneys) {
      const result = await iterate(variant, journey, { iteration: 0, warmup: true, out })
      if (result.error) throw new Error(result.error)
      console.log(`${journey.name}/${journey.case}: recorded`)
    }
    await Bun.write(
      hugeManifest,
      `${JSON.stringify({ ref: hugeRef, recordedAt: new Date().toISOString(), sha: variant.tree.sha }, null, 2)}\n`
    )
    console.log(`huge fixtures in ${hugeFixtures}`)
    console.log(`server timings in ${join(out, 'server-huge-record-0.log')}`)
  } finally {
    await disposeVariant(variant)
  }
}

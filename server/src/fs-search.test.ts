import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { setImmediate } from 'node:timers/promises'

import { fuzzyMatch, rankFiles } from './fs-search'

test('bounded ranking agrees with exhaustive ranking, including ties and late winners', async () => {
  const paths = Array.from({ length: 5000 }, (_, i) => `src/path-${i}/button.ts`)
  paths.push('button.ts', 'a/button.ts', 'b/button.ts', 'missing.ts')
  const all = paths
    .map((path) => ({ path, score: fuzzyMatch(path, 'btn') }))
    .filter((entry): entry is { path: string; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .map((entry) => entry.path)
  for (const limit of [0, 1, 20, 50, 100])
    expect(await Effect.runPromise(rankFiles(paths.join('\0'), 'btn', limit))).toEqual(
      all.slice(0, Math.min(limit, 50))
    )
})

test('broad searches yield to the event loop before scoring finishes', async () => {
  const out = Array.from({ length: 100_000 }, (_, i) => `file-${i}.ts`).join('\0')
  let yielded = false
  const tick = setImmediate().then(() => {
    yielded = true
  })
  const results = await Effect.runPromise(rankFiles(out, 'f', 50))
  expect(yielded).toBe(true)
  expect(results).toHaveLength(50)
  await tick
})

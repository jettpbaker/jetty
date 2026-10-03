// A Jetty to click around in: the working tree's server (echo agent) on a free port plus Vite,
// on a home seeded like the perf lab's. By default GitHub is real and the home persists, with
// threads linked to pr-lab's `sandbox` PRs, so merges and reviews really happen. --replay runs
// a fresh clone of the lab's golden home on recorded GitHub instead, offline.
// usage: bun sandbox [--fresh | --replay]
import { connect } from '@jetty/server/src/rpc-test-client'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { freePort, repoRoot, startServer } from './app'
import { cloneHome, goldenHome, prRepo, seedHome, seedThread } from './seed'

const replay = process.argv.includes('--replay')
const fresh = process.argv.includes('--fresh')
const dir = join(homedir(), 'Library/Caches/jetty-sandbox', replay ? 'replay' : 'live')
const home = join(dir, 'home')
const seeded = join(dir, 'seed.json')
const tree = { label: 'sandbox', dir: repoRoot, sha: 'live', dispose: async () => {} }

// pr-lab PRs labelled `sandbox`, one thread each; the first pair shares a thread.
const sandboxPrs: [title: string, numbers: number[]][] = [
  ['Currency symbols', [12, 14]],
  ['Cart cache', [13]],
  ['Flat discounts', [15]],
  ['README rounding', [17]],
  ['Payouts', [18]],
  ['Integer cents', [19]],
]

const markdownTurn = [
  'Here is the plan for the payouts table:',
  '| Step | Owner | Status | Notes |',
  '| --- | --- | :---: | --- |',
  '| Rename `money` to `format` | Ada | done | Keeps the old export for a release |',
  '| Show transfers on the account page | Lin | in progress | Needs the `transfers` endpoint, which paginates by cursor and returns at most 100 rows per page |',
  '| Reword payout strings | Sam | todo | en.ts only |',
  '',
  'Run it locally first:',
  '```sh\nbun run dev\n```',
  'The formatter now lives here:',
  "```ts\nexport function format(cents: number, currency = 'AUD') {\n  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100)\n}\n```",
  '- [x] Rename the module',
  '- [ ] Transfers list',
  'Inline `code` and a [link](https://example.com).',
].join('\n')

const seed = replay || fresh || !existsSync(seeded)
if (seed) rmSync(dir, { recursive: true, force: true })
if (replay) await cloneHome(await goldenHome(tree), home)
else if (seed) console.log(`seeding ${dir}…`)
const fixtures = seed && !replay ? await seedHome({ tree, dir, gh: { mode: 'replay' } }) : null

const server = await startServer({
  tree,
  home,
  log: join(dir, 'server.log'),
  gh: { mode: 'replay' },
  env: replay ? {} : { PATH: process.env.PATH ?? '' },
})

if (fixtures) {
  const client = await connect(server.port)
  await seedThread(client, fixtures.projectId, 'markdown', [markdownTurn])
  for (const [title, numbers] of sandboxPrs) {
    const text = `Picking up ${numbers.map((n) => `#${n}`).join(' and ')}.`
    const threadId = await seedThread(client, fixtures.projectId, title, [text])
    for (const number of numbers)
      await client.request('pullRequest.link', {
        threadId,
        reference: `https://github.com/${prRepo}/pull/${number}`,
      })
  }
  await client.close()
  await Bun.write(seeded, JSON.stringify(fixtures, null, 2))
}

const vitePort = await freePort()
const vite = Bun.spawn(['bunx', 'vite', '--port', String(vitePort), '--strictPort'], {
  cwd: join(repoRoot, 'client'),
  env: { ...process.env, JETTY_SERVER_PORT: String(server.port) },
  stdout: Bun.file(join(dir, 'vite.log')),
  stderr: Bun.file(join(dir, 'vite.log')),
})
process.on('exit', () => vite.kill())
const url = `http://localhost:${vitePort}`
for (
  let i = 0;
  i < 100 &&
  !(await fetch(url).then(
    (r) => r.ok,
    () => false
  ));
  i++
)
  await Bun.sleep(200)
console.log(`sandbox up: ${url}  (GitHub ${replay ? 'replayed' : 'live'}, logs in ${dir})`)
await new Promise(() => {})

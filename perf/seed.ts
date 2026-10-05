// The golden JETTY_HOME: one project (a git repo with a branch) and the fixture threads,
// seeded through the real WebSocket protocol so it survives schema changes. Cached by a hash
// of everything that shapes it; runs clone it with `cp -c` (an instant APFS clone).
import type { Client } from '@jetty/server/src/rpc-test-client'

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { perfDir, repoRoot, startServer, type GhMode, type Tree } from './app'

export const prRepo = 'jettpbaker/pr-lab'
export const prNumbers = [1, 2, 3, 4]
const homesRoot = join(homedir(), 'Library/Caches/jetty-perf/homes')

export type Fixtures = {
  projectId: string
  threads: Record<'small' | 'long' | 'code' | 'diff', string>
}

export type Golden = { dir: string; home: string; fixtures: Fixtures }

const seedVersion = 1

async function seedHash(tree: Tree) {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(String(seedVersion))
  for (const path of [
    join(perfDir, 'seed.ts'),
    join(tree.dir, 'server/src/db.ts'),
    join(tree.dir, 'server/src/agent.ts'),
  ])
    hasher.update(await Bun.file(path).text())
  hasher.update(readdirSync(join(perfDir, 'fixtures/gh')).sort().join('\n'))
  return hasher.digest('hex').slice(0, 16)
}

export async function goldenHome(tree: Tree, opts: { force?: boolean } = {}): Promise<Golden> {
  const dir = join(homesRoot, await seedHash(tree))
  const ready = join(dir, 'seed.json')
  if (!opts.force && existsSync(ready))
    return { dir, home: join(dir, 'home'), fixtures: await Bun.file(ready).json() }
  console.log(`seeding golden home ${dir}…`)
  await rm(dir, { recursive: true, force: true })
  const fixtures = await seedHome({ tree, dir, gh: { mode: 'replay' } }).catch(async (error) => {
    if (tree.dir === repoRoot || !(await seedWithOwnLab(tree, ready))) throw error
    return Bun.file(ready).json()
  })
  await Bun.write(ready, JSON.stringify(fixtures, null, 2))
  return { dir, home: join(dir, 'home'), fixtures }
}

// A compare's base whose server this lab can't seed (an older protocol, or GitHub calls this
// lab's fixtures lack) seeds with its own lab, whose fixtures may differ a little from these.
async function seedWithOwnLab(tree: Tree, ready: string) {
  if (!existsSync(join(tree.dir, 'perf/seed.ts'))) return false
  console.log(`seeding with ${tree.label}'s own lab instead`)
  await rm(dirname(ready), { recursive: true, force: true })
  const script = `
    const { seedHome } = await import('./perf/seed.ts')
    const tree = { label: 'seed', dir: process.cwd(), sha: '', dispose: async () => {} }
    const fixtures = await seedHome({ tree, dir: process.env.SEED_DIR, gh: { mode: 'replay' } })
    await Bun.write(process.env.SEED_READY, JSON.stringify(fixtures))
    process.exit(0)`
  const child = Bun.spawn(['bun', '-e', script], {
    cwd: tree.dir,
    env: { ...process.env, SEED_DIR: dirname(ready), SEED_READY: ready },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return (await child.exited) === 0 && existsSync(ready)
}

// Clones the golden home for one server; the project repo stays shared and read-only.
export async function cloneHome(golden: Golden, to: string) {
  const child = Bun.spawn(['cp', '-c', '-R', golden.home, to], { stderr: 'pipe' })
  if ((await child.exited) !== 0)
    throw new Error(`cp -c failed: ${await new Response(child.stderr).text()}`)
}

export async function seedHome(opts: { tree: Tree; dir: string; gh: GhMode }): Promise<Fixtures> {
  const home = join(opts.dir, 'home')
  const repo = join(opts.dir, 'repo')
  mkdirSync(home, { recursive: true })
  await createRepo(repo)
  const server = await startServer({
    tree: opts.tree,
    home,
    log: join(opts.dir, 'seed-server.log'),
    gh: opts.gh,
    env: { JETTY_ECHO_CHUNK_MS: '0' },
  })
  let client: Client | undefined
  try {
    client = await server.connect()
    const { project } = await client.request('project.create', { path: repo })
    const threads = {
      small: await seedThread(client, project.id, 'small', smallTurns()),
      long: await seedThread(client, project.id, 'long', longTurns()),
      code: await seedThread(client, project.id, 'code', codeTurns()),
      diff: await seedThread(client, project.id, 'diff', diffTurns()),
    }
    const chrome = client.subscribeChrome()
    await client.request('pullRequest.link', {
      threadId: threads.diff,
      reference: `https://github.com/${prRepo}/pull/${prNumbers[0]}`,
    })
    // The link fetches the PR in the background; the golden home must hold its state.
    await chrome
      .waitFor(
        (message) =>
          message.type === 'thread.upserted' &&
          message.thread.id === threads.diff &&
          !!message.thread.pullRequests?.[0]?.state,
        30_000
      )
      .catch(() => {
        throw new Error(
          'the linked PR never loaded; are the gh fixtures recorded? (bun perf record-gh)'
        )
      })
    await chrome.cancel()
    for (const id of Object.values(threads))
      await client.request('thread.markSeen', { threadId: id })
    return { projectId: project.id, threads }
  } finally {
    await client?.close()
    await server.stop()
  }
}

export async function seedThread(
  client: Client,
  projectId: string,
  title: string,
  turns: string[]
) {
  const id = crypto.randomUUID()
  await client.request('thread.create', { id, projectId, environment: 'local' })
  const sub = client.subscribeThread({ threadId: id })
  await sub.ready
  for (const text of turns) {
    // Bound to a provider the UI's echo models speak, as a thread started there would be.
    const { turnId } = await client.request('turn.start', {
      threadId: id,
      text,
      provider: 'claude',
    })
    await sub.waitFor(
      (message) =>
        message.type === 'event' &&
        (message.event.type === 'turn.completed' || message.event.type === 'turn.failed') &&
        message.event.turnId === turnId,
      30_000
    )
  }
  await sub.cancel()
  await client.request('thread.rename', { threadId: id, title })
  return id
}

async function createRepo(repo: string) {
  mkdirSync(join(repo, 'src'), { recursive: true })
  await Bun.write(join(repo, 'README.md'), '# pr-lab\n\nA fixture project for the perf lab.\n')
  await Bun.write(join(repo, 'src/money.ts'), sourceFile('money', 40))
  await Bun.write(join(repo, 'src/tax.ts'), sourceFile('tax', 60))
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'perf',
    GIT_AUTHOR_EMAIL: 'perf@example.com',
    GIT_COMMITTER_NAME: 'perf',
    GIT_COMMITTER_EMAIL: 'perf@example.com',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  }
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['remote', 'add', 'origin', `https://github.com/${prRepo}.git`],
    ['add', '.'],
    ['commit', '-q', '-m', 'initial'],
    ['branch', 'feat/discount-codes'],
  ]) {
    const child = Bun.spawn(['git', ...args], { cwd: repo, env, stderr: 'pipe' })
    if ((await child.exited) !== 0)
      throw new Error(`git ${args[0]} failed: ${await new Response(child.stderr).text()}`)
  }
}

// Deterministic content: same text on every seed, so counters only move when the app does.
const words =
  'state render thread switch patch cache layout commit paint queue diff branch worktree socket delta stream'.split(
    ' '
  )

function sentence(seed: number, length: number) {
  const out: string[] = []
  for (let i = 0; i < length; i++) out.push(words[(seed * 7 + i * 3) % words.length]!)
  const text = out.join(' ')
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`
}

function smallTurns() {
  return ['Hello there', 'What does the cache do?', 'Thanks, that helps.']
}

function longTurns() {
  const turns: string[] = []
  for (let i = 0; i < 200; i++) {
    const parts = [`Turn ${i + 1}: ${sentence(i, 12)}`, sentence(i + 1, 20)]
    if (i % 3 === 0)
      parts.push(
        `- ${sentence(i + 2, 6)}\n- ${sentence(i + 3, 8)}\n- \`${words[i % words.length]}\``
      )
    if (i % 10 === 0) parts.push(`\`\`\`ts\n${sourceFile(`step${i}`, 8)}\`\`\``)
    turns.push(parts.join('\n\n'))
  }
  return turns
}

function codeTurns() {
  const turns: string[] = []
  for (let i = 0; i < 8; i++)
    turns.push(
      [
        `Review file ${i + 1}:`,
        `\`\`\`ts\n${sourceFile(`module${i}`, 120)}\`\`\``,
        sentence(i, 15),
        `\`\`\`python\n${pythonFile(`module${i}`, 60)}\`\`\``,
      ].join('\n\n')
    )
  return turns
}

function diffTurns() {
  return [
    `Open a PR for discount codes: https://github.com/${prRepo}/pull/${prNumbers[0]}`,
    'Address the review comments.',
  ]
}

function sourceFile(name: string, lines: number) {
  const out = [`import { round } from './math'`, '', `export type ${cap(name)}Entry = {`]
  out.push('  id: string', '  amount: number', '  label: string', '}', '')
  for (let i = 0; out.length < lines; i++) {
    const word = words[i % words.length]!
    out.push(
      `export function ${word}${cap(name)}${i}(entries: ${cap(name)}Entry[], factor = ${i + 1}) {`,
      `  const total = entries.reduce((sum, entry) => sum + entry.amount * factor, 0)`,
      `  return { label: '${word}', total: round(total, 2), count: entries.length }`,
      '}',
      ''
    )
  }
  return `${out.join('\n')}\n`
}

function pythonFile(name: string, lines: number) {
  const out = ['from dataclasses import dataclass', '', '']
  for (let i = 0; out.length < lines; i++) {
    const word = words[i % words.length]!
    out.push(
      `def ${word}_${name}_${i}(entries, factor=${i + 1}):`,
      `    total = sum(entry.amount * factor for entry in entries)`,
      `    return {"label": "${word}", "total": round(total, 2)}`,
      '',
      ''
    )
  }
  return `${out.join('\n')}\n`
}

function cap(text: string) {
  return text[0]!.toUpperCase() + text.slice(1)
}

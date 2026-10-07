import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { freePort, repoRoot, startServer, type Tree } from '../app'
import { cloneHome, goldenHome } from '../seed'
import { prepareReplay } from './replay'

export async function prepareHome(out: string) {
  const tree: Tree = { label: 'paper', dir: repoRoot, sha: 'working-tree', dispose: async () => {} }
  const golden = await goldenHome(tree)
  const dir = join(out, `stack-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const home = join(dir, 'home')
  await cloneHome(golden, home)
  const repo = join(dir, 'repo')
  const pulls = await prepareReplay(join(dir, 'replay'))
  const db = new Database(join(home, 'jetty.db'))
  try {
    const project = db
      .query('SELECT path FROM projects WHERE id=?')
      .get(golden.fixtures.projectId) as { path: string }
    const clone = Bun.spawn(['git', 'clone', '--quiet', '--no-hardlinks', project.path, repo], {
      stdout: 'ignore',
      stderr: 'pipe',
    })
    if (await clone.exited) throw new Error(await new Response(clone.stderr).text())
    const remote = Bun.spawn(
      ['git', 'remote', 'set-url', 'origin', 'https://github.com/jettpbaker/pr-lab.git'],
      { cwd: repo, stdout: 'ignore', stderr: 'pipe' }
    )
    if (await remote.exited) throw new Error(await new Response(remote.stderr).text())
    db.query('UPDATE projects SET path=? WHERE id=?').run(repo, golden.fixtures.projectId)
    for (const tab of ['for-you', 'created'])
      db.query(
        "INSERT OR REPLACE INTO pull_request_lists(tab,items_json,status,error,refreshed_at,truncated) VALUES (?,?,'ready',NULL,?,0)"
      ).run(tab, JSON.stringify(tab === 'created' ? [] : pulls), Date.now())
  } finally {
    db.close()
  }
  return { tree, home, dir, repo, fixtures: golden.fixtures }
}

export async function startStack(prepared: Awaited<ReturnType<typeof prepareHome>>) {
  const server = await startServer({
    tree: prepared.tree,
    home: prepared.home,
    log: join(prepared.dir, 'server.log'),
    gh: { mode: 'replay', misses: join(prepared.dir, 'replay-misses.jsonl') },
    env: {
      JETTY_ECHO_CHUNK_MS: '120',
      JETTY_ECHO_CHUNKS: '80',
      PERF_GH_FIXTURES: join(prepared.dir, 'replay'),
    },
  })
  const port = await freePort()
  const vite = Bun.spawn(
    [join(repoRoot, 'client/node_modules/.bin/vite'), '--port', String(port), '--strictPort'],
    {
      cwd: join(repoRoot, 'client'),
      env: { ...process.env, JETTY_SERVER_PORT: String(server.port) },
      stdout: Bun.file(join(prepared.dir, 'vite.log')),
      stderr: Bun.file(join(prepared.dir, 'vite.log')),
    }
  )
  const onExit = () => {
    if (vite.exitCode === null) vite.kill('SIGTERM')
  }
  process.on('exit', onExit)
  const origin = `http://localhost:${port}`
  let stopped = false
  async function stop() {
    if (stopped) return
    stopped = true
    vite.kill('SIGTERM')
    await vite.exited
    await server.stop()
    process.off('exit', onExit)
  }
  const onSignal = () => {
    void stop().then(() => process.exit(130))
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  try {
    for (let i = 0; i < 150; i++) {
      if (
        await fetch(origin).then(
          (response) => response.ok,
          () => false
        )
      ) {
        return {
          origin,
          server,
          async stop() {
            await stop()
            process.off('SIGTERM', onSignal)
            process.off('SIGINT', onSignal)
          },
        }
      }
      if (vite.exitCode !== null) throw new Error(`Vite exited; see ${prepared.dir}/vite.log`)
      await Bun.sleep(200)
    }
    throw new Error(`Vite startup timed out; see ${prepared.dir}/vite.log`)
  } catch (error) {
    await stop()
    throw error
  }
}

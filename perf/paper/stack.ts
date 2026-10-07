import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { freePort, repoRoot, startServer, type Tree } from '../app'
import { cloneHome, goldenHome } from '../seed'

export async function prepareHome(out: string) {
  const tree: Tree = { label: 'paper', dir: repoRoot, sha: 'working-tree', dispose: async () => {} }
  const golden = await goldenHome(tree)
  const dir = join(out, `stack-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const home = join(dir, 'home')
  await cloneHome(golden, home)
  return { tree, home, dir, fixtures: golden.fixtures }
}

export async function startStack(prepared: Awaited<ReturnType<typeof prepareHome>>) {
  const server = await startServer({
    tree: prepared.tree,
    home: prepared.home,
    log: join(prepared.dir, 'server.log'),
    gh: { mode: 'replay' },
    env: { JETTY_ECHO_CHUNK_MS: '120', JETTY_ECHO_CHUNKS: '80' },
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
  const origin = `http://localhost:${port}`
  let stopped = false
  async function stop() {
    if (stopped) return
    stopped = true
    vite.kill('SIGTERM')
    await vite.exited
    await server.stop()
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

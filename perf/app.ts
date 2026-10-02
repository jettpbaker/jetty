import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const repoRoot = resolve(import.meta.dir, '..')
export const perfDir = import.meta.dir
const workRoot = join(tmpdir(), 'jetty-perf')

// Ports other local Jetty stacks and agents use; the lab never binds them.
const reserved = new Set([5173, 5174, 8787, 8791, 8792, 18970, 18971])

export type Tree = {
  label: string
  dir: string
  sha: string
  dispose(): Promise<void>
}

async function run(cmd: string[], cwd: string, env?: Record<string, string | undefined>) {
  const child = Bun.spawn(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${cmd.join(' ')} failed (${code}):\n${err || out}`)
  return out.trim()
}

export function git(args: string[], cwd = repoRoot) {
  return run(['git', ...args], cwd)
}

// The working tree as it is now (uncommitted edits included), or a git ref, as an isolated
// checkout with its own install and perf-mode client build. Isolation keeps a run stable
// while other agents edit the repo, and never touches the repo's own client/dist.
export async function prepareTree(
  label: string,
  ref?: string,
  opts: { profiling?: boolean } = {}
): Promise<Tree> {
  const dir = join(workRoot, `${label}-${process.pid}-${Date.now().toString(36)}`)
  mkdirSync(dirname(dir), { recursive: true })
  let sha: string
  if (ref) {
    sha = await git(['rev-parse', '--short', ref])
    await git(['worktree', 'prune'])
    await git(['worktree', 'add', '--detach', dir, ref])
  } else {
    const dirty = (await git(['status', '--porcelain'])).length > 0
    sha = `${await git(['rev-parse', '--short', 'HEAD'])}${dirty ? '+dirty' : ''}`
    copyWorkingTree(dir)
  }
  const dispose = async () => {
    if (ref) await git(['worktree', 'remove', '--force', dir]).catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  }
  try {
    await run(['bun', 'install', '--frozen-lockfile'], dir)
    await buildClient(dir, opts.profiling)
  } catch (error) {
    await dispose()
    throw error
  }
  return { label, dir, sha, dispose }
}

function copyWorkingTree(dir: string) {
  const listed = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: repoRoot,
  })
  for (const path of listed.stdout.toString().split('\0')) {
    if (!path) continue
    const from = join(repoRoot, path)
    const to = join(dir, path)
    let stat
    try {
      stat = lstatSync(from)
    } catch {
      continue // deleted but not yet staged
    }
    if (stat.isDirectory()) continue
    mkdirSync(dirname(to), { recursive: true })
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to)
    else copyFileSync(from, to, constants.COPYFILE_FICLONE)
  }
}

async function buildClient(dir: string, profiling = false) {
  const args = ['bun', join(perfDir, 'build-client.ts'), ...(profiling ? ['--profiling'] : [])]
  await run(args, join(dir, 'client'))
}

// The lab's committed output (fixtures, baseline, budgets) is left as the formatter would.
export async function format(path: string) {
  const args = ['bun', 'run', '--silent', 'format', path]
  await Bun.spawn(args, { cwd: repoRoot, stdout: 'ignore' }).exited
}

export async function freePort(): Promise<number> {
  for (;;) {
    const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
    const port = listener.port
    listener.stop(true)
    if (!reserved.has(port)) return port
  }
}

export type GhMode = { mode: 'replay' | 'record'; misses?: string }

export type Server = {
  port: number
  origin: string
  home: string
  stop(): Promise<void>
}

export async function startServer(opts: {
  tree: Tree
  home: string
  log: string
  gh: GhMode
  env?: Record<string, string>
}): Promise<Server> {
  const port = await freePort()
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env))
    if (!key.startsWith('JETTY_') && !key.startsWith('PERF_GH_')) env[key] = value
  Object.assign(env, {
    JETTY_HOME: opts.home,
    JETTY_AGENT: 'echo',
    PORT: String(port),
    HOST: '127.0.0.1',
    PATH: `${join(perfDir, 'bin')}:${process.env.PATH}`,
    PERF_GH_MODE: opts.gh.mode,
    PERF_GH_REAL: realGh(),
    PERF_GH_FIXTURES: join(perfDir, 'fixtures/gh'),
    PERF_GH_MISSES: opts.gh.misses,
    ...opts.env,
  })
  const log = Bun.file(opts.log)
  const child = Bun.spawn(['bun', 'server/src/main.ts'], {
    cwd: opts.tree.dir,
    env,
    stdout: log,
    stderr: log,
    detached: true,
  })
  const origin = `http://127.0.0.1:${port}`
  let exited = false
  live.add(child.pid)
  void child.exited.then(() => {
    exited = true
    live.delete(child.pid)
  })
  const deadline = Date.now() + 30_000
  for (;;) {
    if (exited) throw new Error(`server exited during startup; see ${opts.log}`)
    if (Date.now() > deadline) {
      killGroup(child.pid, 'SIGKILL')
      throw new Error(`server did not become ready; see ${opts.log}`)
    }
    const ok = await fetch(origin).then(
      (response) => response.ok,
      () => false
    )
    if (ok) break
    await Bun.sleep(100)
  }
  return {
    port,
    origin,
    home: opts.home,
    async stop() {
      if (exited) return
      killGroup(child.pid, 'SIGTERM')
      const timeout = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 5000)
      await child.exited
      clearTimeout(timeout)
    },
  }
}

// Servers run in their own process group; never leave one behind if the lab dies or is
// interrupted. An interrupt skips every `finally`, so the exit handler also removes this
// process's trees and homes (their names carry its pid); the next run prunes the worktree
// registrations they leave behind.
const live = new Set<number>()
process.on('exit', () => {
  for (const pid of live) killGroup(pid, 'SIGKILL')
  let names: string[] = []
  try {
    names = readdirSync(workRoot)
  } catch {}
  for (const name of names)
    if (ownDir.test(name)) rmSync(join(workRoot, name), { recursive: true, force: true })
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(130))

const ownDir = new RegExp(`-${process.pid}(-|$)`)

function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
  } catch {
    // already gone
  }
}

function realGh() {
  const binDir = join(perfDir, 'bin')
  const path = (process.env.PATH ?? '').split(':').filter((entry) => resolve(entry) !== binDir)
  return Bun.which('gh', { PATH: path.join(':') }) ?? ''
}

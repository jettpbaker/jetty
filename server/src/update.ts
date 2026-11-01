import type { JettyUpdate } from '@jetty/shared/wire'

import { existsSync, renameSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const checkout = resolve(import.meta.dir, '../..')

async function readOutput(stream: ReadableStream<Uint8Array>, onOutput?: (text: string) => void) {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of stream) {
    const part = decoder.decode(chunk, { stream: true })
    text += part
    onOutput?.(part)
  }
  return text
}

async function command(
  args: string[],
  signal?: AbortSignal,
  cwd = checkout,
  { env: extra, onOutput }: { env?: Record<string, string>; onOutput?: (text: string) => void } = {}
) {
  // A git that wants a login fails rather than waiting on a prompt nobody sees.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extra }
  const child = Bun.spawn(args, { cwd, env, stdout: 'pipe', stderr: 'pipe', signal })
  const [stdout, stderr, code] = await Promise.all([
    readOutput(child.stdout, onOutput),
    readOutput(child.stderr, onOutput),
    child.exited,
  ])
  const output = Bun.stripANSI(`${stdout}\n${stderr}`).trim()
  if (code !== 0) {
    const last = output.split('\n').findLast((line) => {
      const value = line.trim()
      return value && !value.startsWith('error: script') && !value.startsWith('at ')
    })
    throw new Error(last?.trim() || `exit ${code}`)
  }
  return stdout.trim()
}

export async function serverVersion() {
  return command(['git', 'rev-parse', '--short', 'HEAD']).catch(() => undefined)
}

export function createUpdater(home: string, publish: (state: JettyUpdate | undefined) => void) {
  let state: JettyUpdate | undefined
  let pending: Promise<void> | undefined
  const controller = new AbortController()
  const { signal } = controller

  function set(next: JettyUpdate | undefined) {
    if (
      state?.status === next?.status &&
      state?.error === next?.error &&
      state?.step === next?.step &&
      state?.percent === next?.percent
    )
      return
    state = next
    publish(next)
  }

  // Only climbs, and only the next step says this one's done.
  function progress(percent: number) {
    if (state?.status !== 'updating') return
    const next = Math.min(99, Math.round(percent))
    if (next > (state.percent ?? 0)) set({ ...state, percent: next })
  }

  async function eligible() {
    if ((await command(['git', 'branch', '--show-current'], signal)) !== 'main')
      throw new Error("Jetty's checkout isn't on main")
    if (await command(['git', 'status', '--porcelain', '--untracked-files=no'], signal))
      throw new Error("Jetty's checkout has local changes")
    const head = await command(['git', 'rev-parse', 'HEAD'], signal)
    const remote = await command(['git', 'rev-parse', 'origin/main'], signal)
    await command(['git', 'merge-base', '--is-ancestor', head, remote], signal)
    return head !== remote ? head : undefined
  }

  async function check() {
    try {
      await command(['git', 'fetch', 'origin', 'main'], signal)
      const available = await eligible()
      if (!state || state.status === 'available')
        set(available ? { status: 'available' } : undefined)
    } catch {
      if (!state || state.status === 'available') set(undefined)
    }
  }

  async function backup(sha: string) {
    const directory = join(home, 'backups')
    await mkdir(directory, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const path = join(directory, `update-${sha}-${timestamp}.db`)
    const source = join(home, 'jetty.db')
    const size = Bun.file(source).size
    const growth = setInterval(() => progress((Bun.file(path).size / size) * 100), 200)
    try {
      await command(
        [process.execPath, join(import.meta.dir, 'update-backup.ts'), source, path],
        signal
      )
    } catch (error) {
      await rm(path, { force: true })
      throw error
    } finally {
      clearInterval(growth)
    }
    const files = []
    for (const name of await readdir(directory)) {
      if (!name.startsWith('update-')) continue
      const path = join(directory, name)
      const info = await stat(path)
      if (info.isFile()) files.push({ path, time: info.mtimeMs })
    }
    for (const file of files.toSorted((a, b) => b.time - a.time).slice(3)) await rm(file.path)
  }

  async function update() {
    let oldHead: string | undefined
    let pulled = false
    let swapped = false
    let step = 'Check checkout'
    const dist = join(checkout, 'client/dist')
    const next = join(checkout, 'client/dist-next')
    const previous = join(checkout, 'client/dist-previous')
    const modulesFile = join(home, 'update-build-modules')
    let modules = ''
    try {
      oldHead = await eligible()
      if (!oldHead) throw new Error('Jetty is already up to date')
      step = 'Database backup'
      set({ status: 'updating', step: 'backup' })
      await backup(await command(['git', 'rev-parse', '--short', oldHead], signal))
      step = 'git pull'
      set({ status: 'updating', step: 'pull' })
      await command(
        ['git', 'pull', '--progress', '--ff-only', 'origin', 'main'],
        signal,
        checkout,
        {
          onOutput: (text) => {
            for (const match of text.matchAll(/Receiving objects:\s+(\d+)%/g))
              progress(Number(match[1]))
          },
        }
      )
      pulled = true
      step = 'bun install'
      set({ status: 'updating', step: 'install' })
      await command([process.execPath, 'install'], signal)
      step = 'Client build'
      set({ status: 'updating', step: 'build' })
      await rm(next, { recursive: true, force: true })
      await command(
        [process.execPath, 'run', 'build', '--outDir', 'dist-next'],
        signal,
        join(checkout, 'client'),
        {
          env: {
            JETTY_BUILD_PROGRESS: '1',
            JETTY_BUILD_MODULES: await Bun.file(modulesFile)
              .text()
              .catch(() => ''),
          },
          onOutput: (text) => {
            for (const match of text.matchAll(/^jetty-build (\d+)$/gm)) progress(Number(match[1]))
            modules = text.match(/^jetty-build-modules (\d+)$/m)?.[1] ?? modules
          },
        }
      )
      if (modules) await Bun.write(modulesFile, modules)
      step = 'Client swap'
      await rm(previous, { recursive: true, force: true })
      if (existsSync(dist)) renameSync(dist, previous)
      try {
        renameSync(next, dist)
        swapped = true
      } catch (error) {
        if (existsSync(previous)) renameSync(previous, dist)
        throw error
      }
      await rm(previous, { recursive: true, force: true })
      step = 'Restart'
      set({ status: 'restarting' })
      await new Promise<void>((resolve) => setImmediate(resolve))
      process.send!('restart')
      process.kill(process.pid, 'SIGTERM')
    } catch (error) {
      if (swapped) {
        await rm(dist, { recursive: true, force: true })
        if (existsSync(previous)) renameSync(previous, dist)
      }
      if (pulled && oldHead) {
        await command(['git', 'reset', '--keep', oldHead]).catch(() => {})
        await command([process.execPath, 'install']).catch(() => {})
      }
      await rm(next, { recursive: true, force: true }).catch(() => {})
      if (!signal.aborted) {
        const reason = error instanceof Error ? error.message : String(error)
        set({
          status: 'failed',
          error: step === 'Check checkout' ? reason : `${step} failed: ${reason}`,
        })
      }
    }
  }

  function track(task: Promise<void>) {
    const running = task.finally(() => {
      if (pending === running) pending = undefined
    })
    pending = running
  }

  function poll() {
    if (pending || state?.status === 'restarting') return
    track(check())
  }

  const timer = setInterval(poll, 15 * 60 * 1000)
  poll()
  return {
    get state() {
      return state
    },
    start() {
      if (state?.status !== 'available' && state?.status !== 'failed') return
      set({ status: 'updating' })
      const checking = pending
      track(Promise.resolve(checking).then(update))
    },
    async stop() {
      clearInterval(timer)
      controller.abort()
      await pending
    },
  }
}

export type Updater = ReturnType<typeof createUpdater>

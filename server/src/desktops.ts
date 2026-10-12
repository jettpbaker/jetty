import type { ThreadMeta } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Effect } from 'effect'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { DesktopRecord, Store } from './store'

import { StoreError } from './store'

export type Desktops = ReturnType<typeof createDesktops>
type LiveDesktop = Extract<DesktopRecord, { state: 'live' }>
type Session = Omit<LiveDesktop, 'id' | 'state'>

// Fits an agent's headed browser with a 1920x1080 viewport, whose window measures 1928x1165.
const GEOMETRY = '1936x1200'
const START_TIMEOUT = 60_000
const STOP_TIMEOUT = 30_000

function parseSession(line: string): Session | undefined {
  try {
    const value = JSON.parse(line) as Partial<Record<keyof Session, unknown>>
    if (
      typeof value.display === 'string' &&
      typeof value.port === 'number' &&
      typeof value.token === 'string'
    )
      return { display: value.display, port: value.port, token: value.token }
  } catch {
    return undefined
  }
}

const installPath =
  process.env.JETTY_DESKTOP_HOME ?? join(homedir(), '.local/share/jetty-desktop/current')

export function desktopsInstalled(home = installPath) {
  try {
    accessSync(join(home, 'session-start.sh'), constants.X_OK)
    return true
  } catch {
    return false
  }
}

// Desktops come from jetty-desktop's session scripts: a virtual display, window manager and
// streamer per thread, kept across Jetty restarts and stopped with the thread.
export function createDesktops(
  store: Store,
  onChange: (thread: ThreadMeta) => void,
  home = installPath
) {
  const locks = new Map<string, Promise<unknown>>()
  const run = <A>(effect: Effect.Effect<A, StoreError>) => Effect.runPromise(effect)

  async function serialized<A>(threadId: string, action: () => Promise<A>) {
    const pending = (locks.get(threadId) ?? Promise.resolve()).catch(() => {}).then(action)
    locks.set(threadId, pending)
    try {
      return await pending
    } finally {
      if (locks.get(threadId) === pending) locks.delete(threadId)
    }
  }

  async function save(threadId: string, record: DesktopRecord | null) {
    await run(store.saveDesktop(threadId, record))
    onChange(await run(store.requireThread(threadId)))
  }

  async function startSession(name: string) {
    const script = join(home, 'session-start.sh')
    const child = Bun.spawn(
      [script, '--name', name, '--geometry', GEOMETRY, '--no-browser', '--port', '0', '--json'],
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }
    )
    const timer = setTimeout(() => child.kill(), START_TIMEOUT)
    const errors = new Response(child.stderr).text()
    const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
    // Keeps reading so a script still writing never meets a closed pipe.
    const drain = (): void =>
      void reader.read().then(
        (read) => read.done || drain(),
        () => {}
      )
    try {
      let output = ''
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        output += read.value
        const session = output.split('\n').slice(0, -1).map(parseSession).find(Boolean)
        if (session) {
          drain()
          return session
        }
      }
      const session = parseSession(output)
      if (session) return session
      const code = await child.exited
      const detail = (await errors).trim().split('\n').slice(-5).join('\n')
      throw new Error(detail || `session-start.sh exited ${code} without a session`)
    } finally {
      clearTimeout(timer)
    }
  }

  async function stopSession(name: string) {
    const child = Bun.spawn([join(home, 'session-stop.sh'), '--name', name], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), STOP_TIMEOUT)
    try {
      const [errors, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
      if (code !== 0)
        console.warn(`session-stop.sh --name ${name} exited ${code}: ${errors.trim()}`)
    } finally {
      clearTimeout(timer)
    }
  }

  function streamerUrl(desktop: LiveDesktop) {
    const url = new URL(`http://127.0.0.1:${desktop.port}`)
    url.searchParams.set('token', desktop.token)
    return url
  }

  async function alive(desktop: DesktopRecord) {
    if (desktop.state !== 'live') return false
    try {
      const response = await fetch(streamerUrl(desktop), { signal: AbortSignal.timeout(3000) })
      await response.body?.cancel()
      return response.ok
    } catch {
      return false
    }
  }

  // Stops what the scripts may have left and forgets the desktop, unless a newer one replaced it.
  async function end(threadId: string, desktop: DesktopRecord) {
    if (desktopsInstalled(home)) await stopSession(desktop.id).catch(() => {})
    if ((await run(store.getDesktop(threadId)))?.id === desktop.id) await save(threadId, null)
  }

  // The thread's live desktop, started if it has none. A thread id comes only from the caller's
  // own MCP session.
  function ensure(threadId: string) {
    return serialized(threadId, async () => {
      const existing = await run(store.getDesktop(threadId))
      if (existing?.state === 'live' && (await alive(existing))) return existing
      if (existing) await end(threadId, existing)
      if (!desktopsInstalled(home))
        throw new StoreError(
          'not_found',
          `Desktop previews aren't available: jetty-desktop isn't installed at ${home}.`
        )
      const id = newId()
      await save(threadId, { id, state: 'starting' })
      try {
        const desktop: LiveDesktop = { id, state: 'live', ...(await startSession(id)) }
        await save(threadId, desktop)
        return desktop
      } catch (error) {
        await end(threadId, { id, state: 'starting' })
        throw error
      }
    })
  }

  function stop(threadId: string) {
    return serialized(threadId, async () => {
      const existing = await run(store.getDesktop(threadId))
      if (existing) await end(threadId, existing)
    })
  }

  // A restart keeps the desktops still streaming; a start the restart cut short is cleaned up.
  async function reconcile() {
    for (const { threadId, record } of await run(store.listDesktops()))
      if (!(await alive(record))) await end(threadId, record)
  }

  return { ensure, stop, reconcile }
}

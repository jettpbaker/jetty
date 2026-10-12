import type { ThreadMeta } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'
import { Socket } from 'effect/socket'
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

// Only Jetty's own pages may frame the viewer.
const frameHeaders = {
  'Content-Security-Policy': "frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
}

// Hop-by-hop, or describing an encoding fetch has already undone.
const droppedHeaders = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
]

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

// A close code the browser may receive: the streamer's own, or "going away" for an abnormal end.
function closeCode(code: number) {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1001
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

  function streamerUrl(desktop: LiveDesktop, path = '/') {
    const url = new URL(`http://127.0.0.1:${desktop.port}`)
    url.pathname = path
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

  async function find(id: string) {
    return (await run(store.listDesktops())).find(({ record }) => record.id === id)
  }

  // Forgets a desktop whose streamer stopped answering.
  async function check(id: string) {
    const found = await find(id)
    if (!found) return
    await serialized(found.threadId, async () => {
      if (!(await alive(found.record))) await end(found.threadId, found.record)
    })
  }

  // A restart keeps the desktops still streaming; a start the restart cut short is cleaned up.
  async function reconcile() {
    for (const { threadId, record } of await run(store.listDesktops()))
      if (!(await alive(record))) await end(threadId, record)
  }

  // The streamer's socket opens first, so a stopped desktop fails the browser's upgrade. Frames
  // then go straight through in both directions as they arrive, held only until the browser's
  // side is open.
  function relay(request: HttpServerRequest.HttpServerRequest, desktop: LiveDesktop, url: URL) {
    return Effect.gen(function* () {
      const origin = url.origin
      url.protocol = 'ws:'
      const upstream = new WebSocket(url, { headers: { Origin: origin } })
      upstream.binaryType = 'arraybuffer'
      const early: (string | ArrayBuffer)[] = []
      upstream.onmessage = (event: MessageEvent<string | ArrayBuffer>) => early.push(event.data)
      const opened = yield* Effect.callback<boolean>((resume) => {
        upstream.onopen = () => resume(Effect.succeed(true))
        upstream.onclose = () => resume(Effect.succeed(false))
        return Effect.sync(() => upstream.close())
      })
      if (!opened) {
        void check(desktop.id)
        return HttpServerResponse.text('Desktop unavailable', { status: 502 })
      }
      const socket = yield* request.upgrade
      const { write } = yield* socket.writer
      const forward = (data: string | ArrayBuffer) =>
        Effect.runSync(write(typeof data === 'string' ? data : new Uint8Array(data)))
      for (const data of early) forward(data)
      upstream.onmessage = (event: MessageEvent<string | ArrayBuffer>) => forward(event.data)
      upstream.onclose = (event) => {
        Effect.runSync(write(new Socket.CloseEvent(closeCode(event.code))))
        void check(desktop.id)
      }
      if (upstream.readyState !== WebSocket.OPEN) yield* write(new Socket.CloseEvent(1001))
      yield* Effect.gen(function* () {
        const { pull } = yield* socket.reader
        while (true) for (const frame of yield* pull) upstream.send(frame)
      }).pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            upstream.onclose = null
            upstream.close()
          })
        )
      )
      return HttpServerResponse.empty()
    }).pipe(Effect.scoped)
  }

  // /desktop/<id>/… on Jetty's origin, to the streamer the registry has for that id. The caller
  // checks the request is Jetty's own. The streamer refuses foreign origins, so its requests come
  // from its own loopback origin, with its token, which never leaves this server.
  function proxy(request: HttpServerRequest.HttpServerRequest, url: URL) {
    return Effect.gen(function* () {
      const [, id = '', path = '/'] = url.pathname.match(/^\/desktop\/([\w-]+)(\/.*)$/) ?? []
      const found = yield* Effect.promise(() => find(id))
      if (found?.record.state !== 'live')
        return HttpServerResponse.text('Not found', { status: 404 })
      const desktop = found.record
      const target = streamerUrl(desktop, path)
      for (const [key, value] of url.searchParams)
        if (key !== 'secret' && key !== 'token') target.searchParams.append(key, value)
      if (request.headers.upgrade?.toLowerCase() === 'websocket')
        return yield* relay(request, desktop, target)
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return HttpServerResponse.text('Method not allowed', { status: 405 })
      const response = yield* Effect.tryPromise(() =>
        fetch(target, { method: request.method, headers: { Origin: target.origin } })
      ).pipe(Effect.option)
      if (response._tag === 'None') {
        void check(desktop.id)
        return HttpServerResponse.text('Desktop unavailable', { status: 502 })
      }
      const headers = new Headers(response.value.headers)
      for (const name of droppedHeaders) headers.delete(name)
      for (const [name, value] of Object.entries(frameHeaders)) headers.set(name, value)
      return HttpServerResponse.fromWeb(
        new Response(response.value.body, { status: response.value.status, headers })
      )
    })
  }

  return { ensure, stop, reconcile, proxy }
}

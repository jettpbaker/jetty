import type { Usage } from '@jetty/shared/wire'

import { BunRuntime } from '@effect/platform-bun'
import { Context, Effect, Fiber, Layer, ManagedRuntime, Scope } from 'effect'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'

import type { Titler } from './titler'

import { AgentService, echoLayer, type Agent } from './agent'
import { createAttachments } from './attachments'
import { claudeLayer } from './claude'
import { createClaudeTitler } from './claude-titler'
import { openDb } from './db'
import { createHub, type ConnData } from './hub'
import { orchestratorLayer, OrchestratorService } from './orchestrator'
import { rangeResponse } from './range'
import { createStore, type Store } from './store'
import { createWs } from './ws'

export type ServerOptions = {
  home?: string
  port?: number
  hostname?: string
  /** Override agent selection (defaults to JETTY_AGENT env, then 'claude'). */
  agent?: 'echo' | 'claude' | Agent
  /** Override titler (defaults to real titler for claude, null for echo). */
  titler?: Titler | null
}

function selectTitler(kind: 'echo' | 'claude' | Agent): Titler | null {
  if (typeof kind !== 'string') return null
  return kind === 'claude' ? createClaudeTitler() : null
}

function reconcileOnStartup(store: Store) {
  for (const thread of store.listThreads()) {
    const state = store.getThreadState(thread.id)
    if (state.status === 'idle') continue
    store.appendEvent(thread.id, {
      type: 'turn.failed',
      turnId: state.activeTurnId ?? 'unknown',
      error: 'server restarted',
    })
  }
}

const distDir = resolve(import.meta.dir, '../../client/dist')

async function serveStatic(pathname: string): Promise<Response> {
  const indexPath = join(distDir, 'index.html')
  if (!existsSync(indexPath)) {
    return new Response('jetty', { status: 200 })
  }

  const requested = pathname === '/' ? '/index.html' : pathname
  const filePath = normalize(join(distDir, requested))
  if (!filePath.startsWith(distDir + sep)) {
    return new Response('Not found', { status: 404 })
  }

  const file = Bun.file(filePath)
  if (await file.exists()) {
    return new Response(file)
  }

  return new Response(Bun.file(indexPath))
}

const extraOrigins = new Set(
  (process.env.JETTY_ALLOWED_ORIGINS ?? '').split(',').filter((origin) => origin.length > 0)
)

function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || extraOrigins.has(origin)
    )
  } catch {
    return false
  }
}

function createServer(opts: ServerOptions = {}) {
  return Effect.gen(function* () {
    const home = opts.home ?? process.env.JETTY_HOME ?? join(homedir(), '.jetty')
    const port = opts.port ?? Number(process.env.PORT ?? 8787)
    const hostname = opts.hostname ?? process.env.HOST ?? '127.0.0.1'
    const agentKind =
      opts.agent ?? (process.env.JETTY_AGENT === 'echo' ? ('echo' as const) : ('claude' as const))

    const db = yield* Effect.acquireRelease(
      Effect.try(() => openDb(home)),
      (db) => Effect.sync(() => db.close())
    )
    const store = createStore(db)
    yield* Effect.try(() => reconcileOnStartup(store))

    const attachments = yield* Effect.try(() => createAttachments(home))
    const hub = createHub()
    let lastUsage: Usage | null = null
    const hooks = {
      onUsage(usage: Usage) {
        lastUsage = usage
        hub.pushChrome({ type: 'usage', usage })
      },
    }
    const agentLayer =
      typeof agentKind !== 'string'
        ? Layer.succeed(AgentService, agentKind)
        : agentKind === 'echo'
          ? echoLayer(hooks)
          : claudeLayer(store, attachments, hooks)
    const titler = opts.titler !== undefined ? opts.titler : selectTitler(agentKind)
    const services = yield* Layer.build(
      Layer.merge(
        agentLayer,
        orchestratorLayer(store, hub, titler, attachments).pipe(Layer.provide(agentLayer))
      )
    )
    const agent = Context.get(services, AgentService)
    const orch = Context.get(services, OrchestratorService)
    const requestScope = yield* Scope.fork(yield* Effect.scope)
    const context = yield* Effect.context<never>()
    const run = Effect.runPromiseWith(context)
    const ws = createWs(
      store,
      orch,
      hub,
      (effect) =>
        run(
          Effect.gen(function* () {
            const fiber = yield* Effect.forkIn(effect, requestScope)
            return yield* Fiber.join(fiber)
          })
        ),
      () => lastUsage
    )

    const server = yield* Effect.acquireRelease(
      Effect.try(() =>
        Bun.serve<ConnData>({
          port,
          hostname,
          async fetch(req, server) {
            const url = new URL(req.url)
            if (url.pathname === '/ws') {
              // WebSockets bypass CORS: without this gate any webpage could open
              // ws://localhost:8787 and drive the agent. Browser clients must come
              // from a loopback origin (or JETTY_ALLOWED_ORIGINS); native clients
              // send no Origin and are as trusted as anything else on this machine.
              if (!originAllowed(req)) {
                return new Response('Forbidden origin', { status: 403 })
              }
              if (server.upgrade(req, { data: { chrome: false, threads: new Set() } })) {
                return undefined
              }
              return new Response('WebSocket upgrade failed', { status: 400 })
            }

            if (req.method === 'GET' && url.pathname.startsWith('/attachments/')) {
              const id = url.pathname.slice('/attachments/'.length)
              // single path segment only — reject nested paths / empty / encoded traversal
              if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
                return new Response('Not found', { status: 404 })
              }
              const resolved = attachments.resolve(id)
              if (!resolved) return new Response('Not found', { status: 404 })
              const file = Bun.file(resolved.path)
              if (!(await file.exists())) return new Response('Not found', { status: 404 })
              return rangeResponse(file, resolved.mimeType, req.headers.get('Range'))
            }

            return serveStatic(url.pathname)
          },
          websocket: ws.handlers,
        })
      ),
      (server) =>
        Effect.sync(() => {
          ws.stop()
          server.stop(true)
        })
    )

    const boundPort = server.port
    if (boundPort === undefined)
      return yield* Effect.fail(new Error('server failed to bind a port'))

    return {
      server,
      home,
      port: boundPort,
      hostname: server.hostname,
      store,
      agent,
    }
  })
}

export const ServerService =
  Context.Service<Effect.Success<ReturnType<typeof createServer>>>('jetty/Server')

export function serverLayer(opts: ServerOptions = {}) {
  return Layer.effect(ServerService, createServer(opts))
}

export async function startServer(opts: ServerOptions = {}) {
  const runtime = ManagedRuntime.make(serverLayer(opts))
  try {
    const running = await runtime.runPromise(ServerService)
    let stopped: Promise<void> | undefined
    return {
      ...running,
      stop() {
        return (stopped ??= runtime.dispose())
      },
    }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const running = yield* ServerService
      yield* Effect.logInfo(`jetty listening on http://${running.hostname}:${running.port}`)
      yield* Effect.never
    }).pipe(Effect.provide(serverLayer()))
  )
}

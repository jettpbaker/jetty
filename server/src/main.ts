import type { Usage } from '@jetty/shared/wire'

import { BunHttpServer, BunRuntime, BunServices } from '@effect/platform-bun'
import { JettyRpcs } from '@jetty/shared/rpc'
import { Context, Effect, FileSystem, Layer, ManagedRuntime, Scope, Path } from 'effect'
import { HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { ChildProcessSpawner } from 'effect/unstable/process'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import { homedir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'

import type { Titler } from './titler'

import { AgentService, echoLayer, type Agent } from './agent'
import { Attachments, AttachmentsLive } from './attachments'
import { claudeLayer } from './claude'
import { createClaudeTitler } from './claude-titler'
import { codexLayer, type CodexOptions } from './codex'
import { databaseLayer } from './db'
import { GitDiffLive } from './diff'
import { FileBrowserLive } from './fs-browse'
import { FileSearchLive } from './fs-search'
import { createHub } from './hub'
import { orchestratorLayer, OrchestratorService } from './orchestrator'
import { rangeResponse } from './range'
import { SkillsLive } from './skills'
import { Store, storeLayer } from './store'
import { createRpcHandlers } from './ws'

export type ServerOptions = {
  home?: string
  port?: number
  hostname?: string
  /** Override agent selection (defaults to JETTY_AGENT env, then 'claude'). */
  agent?: 'echo' | 'claude' | 'codex' | Agent
  /** Override titler (defaults to real titler for claude, null for echo). */
  titler?: Titler | null
  codex?: CodexOptions
}

function selectTitler(kind: 'echo' | 'claude' | 'codex' | Agent): Titler | null {
  if (typeof kind !== 'string') return null
  return kind === 'claude' ? createClaudeTitler() : null
}

function reconcileOnStartup(store: Store) {
  return Effect.gen(function* () {
    for (const thread of yield* store.listThreads()) {
      const state = yield* store.getThreadState(thread.id)
      if (state.status === 'idle') continue
      yield* store.appendEvent(thread.id, {
        type: 'turn.failed',
        turnId: state.activeTurnId ?? 'unknown',
        error: 'server restarted',
      })
    }
  })
}

const distDir = resolve(import.meta.dir, '../../client/dist')

function serveStatic(pathname: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const indexPath = join(distDir, 'index.html')
    if (!(yield* fs.exists(indexPath))) return HttpServerResponse.text('jetty')
    const requested = pathname === '/' ? '/index.html' : pathname
    const filePath = normalize(join(distDir, requested))
    if (!filePath.startsWith(distDir + sep)) {
      return HttpServerResponse.text('Not found', { status: 404 })
    }
    const stat = yield* fs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(null)))
    const path = stat?.type === 'File' ? filePath : indexPath
    return yield* HttpServerResponse.file(path)
  })
}

const extraOrigins = new Set(
  (process.env.JETTY_ALLOWED_ORIGINS ?? '').split(',').filter((origin) => origin.length > 0)
)

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || extraOrigins.has(origin)
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
      opts.agent ??
      (process.env.JETTY_AGENT === 'codex'
        ? 'codex'
        : process.env.JETTY_AGENT === 'echo'
          ? 'echo'
          : 'claude')

    const database = yield* Layer.build(storeLayer.pipe(Layer.provide(databaseLayer(home))))
    const store = Context.get(database, Store)
    yield* reconcileOnStartup(store)

    const io = yield* Layer.build(
      Layer.mergeAll(
        AttachmentsLive(home),
        FileBrowserLive,
        FileSearchLive,
        SkillsLive,
        GitDiffLive
      )
    )
    const attachments = Context.get(io, Attachments)
    const hub = createHub()
    let lastUsage: Usage | null = null
    const hooks = {
      onUsage(usage: Usage) {
        lastUsage = usage
        hub.pushChrome({ type: 'usage', usage })
      },
    }
    const agentLayer: Layer.Layer<
      Agent,
      never,
      Path.Path | ChildProcessSpawner.ChildProcessSpawner
    > =
      typeof agentKind !== 'string'
        ? Layer.succeed(AgentService, agentKind)
        : agentKind === 'echo'
          ? echoLayer(hooks)
          : agentKind === 'codex'
            ? codexLayer(store, opts.codex)
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
    const admissionScope = yield* Scope.fork(yield* Effect.scope)
    const handlers = yield* createRpcHandlers(store, orch, hub, () => lastUsage).pipe(
      Effect.provideService(Scope.Scope, admissionScope),
      Effect.provideContext(io)
    )
    const transportScope = yield* Scope.fork(yield* Effect.scope)
    const http = yield* Layer.build(
      BunHttpServer.layer({ port, hostname, disablePreemptiveShutdown: true })
    ).pipe(Effect.provideService(Scope.Scope, transportScope))
    const server = Context.get(http, HttpServer.HttpServer)
    const websocket = yield* RpcServer.toHttpEffectWebsocket(JettyRpcs).pipe(
      Effect.provide(JettyRpcs.toLayer(handlers)),
      Effect.provide(RpcSerialization.layerJson),
      Effect.provideService(Scope.Scope, transportScope)
    )
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/ws') {
        if (!originAllowed(request.headers.origin)) {
          return HttpServerResponse.text('Forbidden origin', { status: 403 })
        }
        if (request.headers.upgrade?.toLowerCase() !== 'websocket') {
          return HttpServerResponse.text('WebSocket upgrade failed', { status: 400 })
        }
        return yield* websocket
      }
      if (request.method === 'GET' && url.pathname.startsWith('/attachments/')) {
        const id = url.pathname.slice('/attachments/'.length)
        const resolved = yield* attachments.resolve(id)
        if (!resolved) return HttpServerResponse.text('Not found', { status: 404 })
        return yield* rangeResponse(resolved.path, resolved.mimeType, request.headers.range ?? null)
      }
      return yield* serveStatic(url.pathname)
    }).pipe(
      Effect.catch(() => Effect.succeed(HttpServerResponse.text('Not found', { status: 404 }))),
      Effect.interruptible
    )
    yield* server
      .serve(app)
      .pipe(Effect.provideContext(http), Effect.provideService(Scope.Scope, transportScope))
    if (server.address._tag !== 'TcpAddress') {
      return yield* Effect.fail(new Error('server failed to bind a TCP port'))
    }

    return {
      server,
      home,
      port: server.address.port,
      hostname: server.address.hostname,
      store,
      agent,
      hub,
    }
  })
}

export const ServerService =
  Context.Service<Effect.Success<ReturnType<typeof createServer>>>('jetty/Server')

export function serverLayer(opts: ServerOptions = {}) {
  return Layer.effect(ServerService, createServer(opts)).pipe(Layer.provide(BunServices.layer))
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

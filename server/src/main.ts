import type { ProviderModel } from '@jetty/shared/wire'

import { BunHttpServer, BunRuntime, BunServices } from '@effect/platform-bun'
import { JettyRpcs } from '@jetty/shared/rpc'
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_TURN, type RateLimits } from '@jetty/shared/wire'
import { Context, Effect, FileSystem, Layer, ManagedRuntime, Scope } from 'effect'
import { HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import { homedir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'

import { AgentService, ECHO_MODELS, echoLayer, type Agent } from './agent'
import { Attachments, AttachmentsLive } from './attachments'
import { claudeLayer } from './claude'
import { discoverClaudeModels } from './claude-models'
import { createClaudeTitler } from './claude-titler'
import { codexLayer, type CodexOptions } from './codex'
import { discoverCodexModels } from './codex-models'
import { createCodexTitler } from './codex-titler'
import { databaseLayer } from './db'
import { GitDiffLive } from './diff'
import { FileBrowserLive } from './fs-browse'
import { FileSearchLive } from './fs-search'
import { grokLayer, type GrokOptions } from './grok'
import { discoverGrokModels } from './grok-models'
import { createGrokTitler } from './grok-titler'
import { createHub } from './hub'
import { orchestratorLayer, OrchestratorService } from './orchestrator'
import { rangeResponse } from './range'
import { agentRegistry, singleAgentRegistry, type AgentProvider } from './registry'
import { SkillsLive } from './skills'
import { Store, storeLayer } from './store'
import { chainTitlers, firstLineTitler, type Titler } from './titler'
import { createRpcHandlers } from './ws'

export type ServerOptions = {
  home?: string
  port?: number
  hostname?: string
  agent?: 'echo' | 'claude' | 'codex' | 'grok' | Agent
  titler?: Titler | null
  grok?: GrokOptions
  codex?: CodexOptions
}

function selectTitler(kind: NonNullable<ServerOptions['agent']>, opts: ServerOptions) {
  return Effect.gen(function* () {
    if (opts.titler !== undefined) {
      const fixed = opts.titler
      if (!fixed) return null
      return (_provider: AgentProvider, text: string) => fixed(text)
    }
    if (typeof kind !== 'string') return null
    if (kind === 'echo') return (_provider: AgentProvider, text: string) => firstLineTitler(text)
    const luna = yield* createCodexTitler(opts.codex)
    const claude = createClaudeTitler()
    const grok = yield* createGrokTitler(opts.grok)
    return (provider: AgentProvider, text: string) => {
      if (provider === 'echo') return firstLineTitler(text)
      const own = provider === 'claude' ? [claude] : provider === 'grok' ? [grok] : []
      return chainTitlers(luna, ...own, firstLineTitler)(text)
    }
  })
}

function loadAgent<R>(layer: Layer.Layer<Agent, never, R>) {
  return Effect.gen(function* () {
    return Context.get(yield* Layer.build(layer), AgentService)
  })
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

// base64 inflates by 4/3; the extra MiB covers the rest of the turn.start frame.
const MAX_TURN_PAYLOAD_BYTES =
  Math.ceil((MAX_IMAGES_PER_TURN * MAX_IMAGE_BYTES * 4) / 3) + 1024 * 1024

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
    const envAgent = process.env.JETTY_AGENT
    const agentKind =
      opts.agent ??
      (envAgent === 'grok' || envAgent === 'codex' || envAgent === 'echo' ? envAgent : 'claude')

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
    let lastUsage: RateLimits | null = null
    const hooks = {
      onUsage(usage: RateLimits) {
        lastUsage = usage
        hub.pushChrome({ type: 'usage', usage })
      },
    }
    const registry =
      typeof agentKind !== 'string'
        ? singleAgentRegistry(agentKind)
        : agentKind === 'echo'
          ? singleAgentRegistry(yield* loadAgent(echoLayer(hooks)))
          : agentRegistry(
              {
                claude: yield* loadAgent(claudeLayer(store, attachments, hooks)),
                codex: yield* loadAgent(codexLayer(store, opts.codex)),
                grok: yield* loadAgent(grokLayer(store, opts.grok)),
              },
              agentKind
            )
    let models: readonly ProviderModel[] | null = agentKind === 'echo' ? ECHO_MODELS : null
    if (typeof agentKind === 'string' && agentKind !== 'echo') {
      yield* Effect.all(
        [
          discoverClaudeModels(),
          discoverCodexModels(home, opts.codex),
          discoverGrokModels(home, opts.grok),
        ],
        { concurrency: 'unbounded' }
      ).pipe(
        Effect.flatMap((lists) =>
          hub.withChromePublication(
            Effect.sync(() => {
              const next = lists.flat()
              models = next
              hub.pushChrome({ type: 'models', models: next })
            })
          )
        ),
        Effect.forkIn(yield* Effect.scope)
      )
    }
    const titler = yield* selectTitler(agentKind, opts)
    const services = yield* Layer.build(
      orchestratorLayer(store, hub, titler, attachments, registry)
    )
    const orch = Context.get(services, OrchestratorService)
    const admissionScope = yield* Scope.fork(yield* Effect.scope)
    const handlers = yield* createRpcHandlers(
      store,
      orch,
      hub,
      () => lastUsage,
      () => models
    ).pipe(Effect.provideService(Scope.Scope, admissionScope), Effect.provideContext(io))
    const transportScope = yield* Scope.fork(yield* Effect.scope)
    const http = yield* Layer.build(
      BunHttpServer.layer({
        port,
        hostname,
        disablePreemptiveShutdown: true,
        websocket: { maxPayloadLength: MAX_TURN_PAYLOAD_BYTES },
      })
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
      home,
      port: server.address.port,
      hostname: server.address.hostname,
      store,
      hub,
    }
  })
}

const ServerService =
  Context.Service<Effect.Success<ReturnType<typeof createServer>>>('jetty/Server')

function serverLayer(opts: ServerOptions = {}) {
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

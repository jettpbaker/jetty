import type { ProviderModel } from '@jetty/shared/wire'

import { BunHttpServer, BunRuntime, BunServices } from '@effect/platform-bun'
import { JettyRpcs } from '@jetty/shared/rpc'
import { MAX_TURN_IMAGE_BYTES, type RateLimits } from '@jetty/shared/wire'
import { Context, Deferred, Effect, FileSystem, Layer, ManagedRuntime, Option, Scope } from 'effect'
import { HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { ChildProcessSpawner } from 'effect/unstable/process'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'

import { AgentService, ECHO_MODELS, echoLayer, type Agent } from './agent'
import { Attachments, AttachmentsLive } from './attachments'
import { claudeLayer } from './claude'
import { claudeBin } from './claude-bin'
import { discoverClaudeModels } from './claude-models'
import { createClaudeTitler } from './claude-titler'
import { codexLayer, type CodexOptions } from './codex'
import { discoverCodexModels } from './codex-models'
import { createCodexTitler } from './codex-titler'
import { createEnvironmentManager } from './containers'
import { databaseLayer } from './db'
import { GitDiffLive } from './diff'
import { FileBrowserLive } from './fs-browse'
import { FileSearchLive } from './fs-search'
import { grokLayer, type GrokOptions } from './grok'
import { discoverGrokModels } from './grok-models'
import { createGrokTitler } from './grok-titler'
import { createHub } from './hub'
import { createMcpHandler } from './mcp'
import { createMcpSessions } from './mcp-sessions'
import { orchestratorLayer, OrchestratorService } from './orchestrator'
import { createAutoLinkPullRequests, createPullRequests } from './pull-requests'
import { rangeResponse } from './range'
import { agentRegistry, singleAgentRegistry, type AgentProvider } from './registry'
import { createReviewClassifier } from './review'
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
      for (const item of state.items)
        if ((item.kind === 'subagent' || item.kind === 'workflow') && item.status === 'running')
          yield* store.appendEvent(thread.id, {
            type: 'item.completed',
            itemId: item.id,
            patch:
              item.kind === 'workflow'
                ? { status: 'stopped', stopReason: 'crash' }
                : { status: 'stopped' },
          })
      if (!state.activeTurnId) continue
      yield* store.transaction(
        Effect.gen(function* () {
          yield* store.setQueuePaused(thread.id, true)
          for (const item of state.items) {
            if (item.turnId !== state.activeTurnId) continue
            if (item.kind === 'approval' && !item.decision)
              yield* store.appendEvent(thread.id, {
                type: 'item.completed',
                itemId: item.id,
                patch: { decision: 'deny', deniedReason: 'Jetty restarted' },
              })
            if (
              item.kind === 'question' &&
              item.delivery !== 'async' &&
              !item.answers &&
              !item.skipped &&
              !item.dismissed
            )
              yield* store.appendEvent(thread.id, {
                type: 'item.completed',
                itemId: item.id,
                patch: { skipped: true },
              })
          }
          yield* store.appendEvent(
            thread.id,
            {
              type: 'turn.failed',
              turnId: state.activeTurnId!,
              error: 'server_restarted',
            },
            false
          )
        })
      )
    }
  })
}

// base64 inflates by 4/3; the extra MiB covers the rest of the turn.start frame.
const MAX_TURN_PAYLOAD_BYTES = Math.ceil((MAX_TURN_IMAGE_BYTES * 4) / 3) + 1024 * 1024

const distDir = resolve(import.meta.dir, '../../client/dist')

function serveStatic(pathname: string, wsSecret: string, localPeer: boolean) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const indexPath = join(distDir, 'index.html')
    const secretTag = `<meta name="jetty-ws-secret" content="${wsSecret}">`
    if (!(yield* fs.exists(indexPath)))
      return localPeer
        ? HttpServerResponse.html(secretTag)
        : HttpServerResponse.text('Forbidden', { status: 403 })
    const requested = pathname === '/' ? '/index.html' : pathname
    const filePath = normalize(join(distDir, requested))
    if (!filePath.startsWith(distDir + sep)) {
      return HttpServerResponse.text('Not found', { status: 404 })
    }
    const stat = yield* fs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(null)))
    const path = stat?.type === 'File' ? filePath : indexPath
    if (path === indexPath) {
      if (!localPeer) return HttpServerResponse.text('Forbidden', { status: 403 })
      const html = yield* fs.readFileString(indexPath)
      return HttpServerResponse.html(html.replace('</head>', `${secretTag}</head>`))
    }
    return yield* HttpServerResponse.file(path)
  })
}

const extraOrigins = new Set(
  (process.env.JETTY_ALLOWED_ORIGINS ?? '').split(',').filter((origin) => origin.length > 0)
)

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname
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
    const wsSecret = randomBytes(32).toString('hex')
    const envAgent = process.env.JETTY_AGENT
    const agentKind =
      opts.agent ??
      (envAgent === 'grok' || envAgent === 'codex' || envAgent === 'echo' ? envAgent : 'claude')

    const database = yield* Layer.build(storeLayer.pipe(Layer.provide(databaseLayer(home))))
    const store = Context.get(database, Store)
    yield* reconcileOnStartup(store)
    const containers =
      process.env.JETTY_CONTAINERS === '1'
        ? createEnvironmentManager(store, home, <A, E>(effect: Effect.Effect<A, E>) =>
            Effect.runPromise(effect)
          )
        : undefined
    if (containers) yield* Effect.promise(() => containers.reconcile())
    if (containers)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => containers.shutdown()).pipe(Effect.catch(() => Effect.void))
      )

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
    const pullRequests = createPullRequests(store, hub)
    const mcp = createMcpSessions()
    let lastUsage: RateLimits | null = null
    const hooks = {
      onUsage(usage: RateLimits) {
        lastUsage = usage
        Effect.runFork(
          hub.withChromePublication(Effect.sync(() => hub.pushChrome({ type: 'usage', usage })))
        )
      },
    }
    let models: readonly ProviderModel[] | null = agentKind === 'echo' ? ECHO_MODELS : null
    const registry =
      typeof agentKind !== 'string'
        ? singleAgentRegistry(agentKind)
        : agentKind === 'echo'
          ? singleAgentRegistry(yield* loadAgent(echoLayer(hooks)))
          : agentRegistry(
              {
                claude: yield* loadAgent(
                  claudeLayer(store, hooks, {
                    mcp,
                    supportsAutoMode: (id) =>
                      models?.find((model) => model.provider === 'claude' && model.id === id)
                        ?.autoMode !== false,
                  })
                ),
                codex: yield* loadAgent(codexLayer(store, { ...opts.codex, mcp })),
                grok: yield* loadAgent(grokLayer(store, { ...opts.grok, mcp })),
              },
              agentKind
            )
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const discoveryScope = yield* Effect.scope
    let inFlight: Deferred.Deferred<void> | undefined
    let lastDiscovery = -Infinity

    function refreshModels(force = false) {
      return Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          if (inFlight) return restore(Deferred.await(inFlight))
          if (typeof agentKind !== 'string' || agentKind === 'echo') return Effect.void
          if (!force && Date.now() - lastDiscovery < 60_000) return Effect.void
          lastDiscovery = Date.now()
          const done = Deferred.makeUnsafe<void>()
          inFlight = done
          const initial = models === null
          const lists = new Map(
            ['claude', 'codex', 'grok'].map((provider) => [
              provider,
              models?.filter((model) => model.provider === provider) ?? [],
            ])
          )
          function publish() {
            return hub.withChromePublication(
              Effect.sync(() => {
                models = [...lists.values()].flat()
                hub.pushChrome({ type: 'models', models })
              })
            )
          }
          const probes = [
            ['claude', discoverClaudeModels().pipe(Effect.orElseSucceed(() => null))],
            ['codex', discoverCodexModels(home, opts.codex).pipe(Effect.orElseSucceed(() => null))],
            ['grok', discoverGrokModels(home, opts.grok).pipe(Effect.orElseSucceed(() => null))],
          ] as const
          return Effect.all(
            probes.map(([provider, probe]) =>
              probe.pipe(
                Effect.flatMap((next) => {
                  if (next === null) return Effect.void
                  lists.set(provider, next)
                  return initial ? Effect.void : publish()
                })
              )
            ),
            { concurrency: 'unbounded', discard: true }
          ).pipe(
            Effect.andThen(() => (initial ? publish() : Effect.void)),
            Effect.onExit((exit) => {
              inFlight = undefined
              return Deferred.done(done, exit)
            }),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.interruptible,
            Effect.forkIn(discoveryScope),
            Effect.andThen(restore(Deferred.await(done)))
          )
        })
      )
    }
    yield* refreshModels().pipe(Effect.forkIn(discoveryScope))
    const titler = yield* selectTitler(agentKind, opts)
    const reviewer =
      typeof agentKind === 'string' && agentKind !== 'echo'
        ? yield* createReviewClassifier(opts.codex)
        : undefined
    const services = yield* Layer.build(
      orchestratorLayer({
        store,
        hub,
        titler,
        attachments,
        agent: registry,
        onCompletedText: (threadId, text) =>
          createAutoLinkPullRequests(
            store,
            hub,
            pullRequests,
            discoveryScope
          )(threadId, text).pipe(Effect.catchCause((cause) => Effect.logWarning(cause))),
        reviewer,
        modelCatalog: () =>
          Effect.gen(function* () {
            if (models === null) yield* refreshModels()
            else yield* refreshModels().pipe(Effect.forkIn(discoveryScope))
            return models ?? []
          }),
        environments: containers,
      })
    )
    const orch = Context.get(services, OrchestratorService)
    const admissionScope = yield* Scope.fork(yield* Effect.scope)
    const handlers = yield* createRpcHandlers(
      store,
      orch,
      hub,
      () => lastUsage,
      () => models,
      refreshModels,
      pullRequests,
      containers
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
    const handleMcp = yield* createMcpHandler(
      mcp,
      store,
      orch,
      attachments,
      () => models,
      containers
    )
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, 'http://localhost')
      const peer = request.remoteAddress
      const localPeer =
        peer &&
        Option.isSome(peer) &&
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer.value)
      if (url.pathname === '/mcp') {
        if (request.headers.origin && !originAllowed(request.headers.origin))
          return HttpServerResponse.text('Forbidden origin', { status: 403 })
        const web = yield* HttpServerRequest.toWeb(request)
        return HttpServerResponse.fromWeb(yield* Effect.promise(() => handleMcp(web)))
      }
      if (url.pathname === '/ws') {
        if (!originAllowed(request.headers.origin)) {
          return HttpServerResponse.text('Forbidden origin', { status: 403 })
        }
        const supplied = url.searchParams.get('secret')
        if (
          !supplied ||
          supplied.length !== wsSecret.length ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(wsSecret))
        )
          return HttpServerResponse.text('Forbidden', { status: 403 })
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
      return yield* serveStatic(url.pathname, wsSecret, !!localPeer)
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

    const mcpHostname = server.address.hostname.replace(/^\[|\]$/g, '')
    mcp.setUrl(
      `http://${mcpHostname.includes(':') ? `[${mcpHostname}]` : mcpHostname}:${server.address.port}/mcp`
    )
    if (containers) {
      const mcpPort = Number(process.env.JETTY_CONTAINER_MCP_PORT ?? 8788)
      const mcpBind =
        process.env.JETTY_CONTAINER_MCP_BIND ??
        (process.platform === 'linux'
          ? (process.env.JETTY_DOCKER_BRIDGE_GATEWAY ?? '172.17.0.1')
          : '127.0.0.1')
      const listener = Bun.serve({
        hostname: mcpBind,
        port: mcpPort,
        fetch(request) {
          if (new URL(request.url).pathname !== '/mcp')
            return new Response('Not found', { status: 404 })
          return handleMcp(request)
        },
      })
      mcp.setContainerUrl(
        process.env.JETTY_CONTAINER_MCP_URL ?? `http://host.docker.internal:${listener.port}/mcp`
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => listener.stop(true)))
    }
    yield* orch.resumeQueues()

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
      if (!claudeBin)
        yield* Effect.logWarning("no installed claude found; using the SDK's bundled CLI")
      yield* Effect.never
    }).pipe(Effect.provide(serverLayer()))
  )
}

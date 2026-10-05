import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { ModelDiscovery, ProviderId, ProviderModel } from '@jetty/shared/wire'

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { BunHttpServer, BunRuntime, BunServices } from '@effect/platform-bun'
import {
  heldByRestarts,
  RESTART_LIMIT,
  RESTART_LIMIT_NOTE,
  RESTART_WINDOW_MS,
} from '@jetty/shared/items'
import { findProviderModel } from '@jetty/shared/model-name'
import { JettyRpcs } from '@jetty/shared/rpc'
import { MAX_TURN_IMAGE_BYTES, newId } from '@jetty/shared/wire'
import { Database } from 'bun:sqlite'
import {
  Context,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Schedule,
  Scope,
} from 'effect'
import { HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { NetAddress } from 'effect/net'
import { ChildProcessSpawner } from 'effect/process'
import { RpcSerialization, RpcServer } from 'effect/rpc'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'

import {
  AgentService,
  ECHO_MODELS,
  echoUsage,
  echoLayer,
  type Agent,
  type AgentHooks,
} from './agent'
import { Attachments, AttachmentsLive } from './attachments'
import { claudeLayer } from './claude'
import { claudeBin } from './claude-bin'
import { discoverClaudeModels } from './claude-models'
import { codexLayer, type CodexOptions } from './codex'
import { discoverCodexModels } from './codex-models'
import { databaseLayer } from './db'
import { GitDiffLive } from './diff'
import { FileBrowserLive } from './fs-browse'
import { FileSearchLive } from './fs-search'
import { createGithubMedia, GithubMediaError } from './github-media'
import { grokLayer, type GrokOptions } from './grok'
import { discoverGrokModels } from './grok-models'
import { createHub } from './hub'
import { createMcpHandler } from './mcp'
import { createMcpSessions } from './mcp-sessions'
import { orchestratorLayer, OrchestratorService } from './orchestrator'
import { createPerfSink } from './perf-sink'
import {
  noteClaudeTurnUsage,
  readClaudeProviderUsage,
  readCodexProviderUsage,
  readGrokProviderUsage,
} from './provider-usage'
import { createPullRequestWatch } from './pull-request-watch'
import { createPullRequestLinks, createPullRequests } from './pull-requests'
import { rangeResponse } from './range'
import { agentRegistry, singleAgentRegistry, type AgentProvider } from './registry'
import { SkillsLive } from './skills'
import { Store, storeLayer } from './store'
import { createTitlePrompt, type TitlePrompt } from './title-model'
import { chainTitlers, firstLineTitler, titleModelTitler, type Titler } from './titler'
import { createWorktrees } from './worktrees'
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

function selectTitler(
  kind: NonNullable<ServerOptions['agent']>,
  opts: ServerOptions,
  prompt: TitlePrompt
) {
  if (opts.titler !== undefined) {
    if (!opts.titler) return null
    const fixed = chainTitlers(opts.titler)
    return (_provider: AgentProvider, text: string) => fixed(text)
  }
  if (typeof kind !== 'string') return null
  const titler = chainTitlers(titleModelTitler(prompt), firstLineTitler)
  return (provider: AgentProvider, text: string) =>
    provider === 'echo' ? firstLineTitler(text) : titler(text)
}

function loadAgent<R>(layer: Layer.Layer<Agent, never, R>) {
  return Effect.gen(function* () {
    return Context.get(yield* Layer.build(layer), AgentService)
  })
}

// bun --watch delivers SIGTERM and restarts this script in-process once the handler returns
// (it gives up after about half a second). Timers and Effect finalizers do not run, so the
// clean-exit row has to be committed before the handler returns. SIGINT and stop() use it too.
export function markCleanShutdown(home: string) {
  let db: Database | undefined
  try {
    db = new Database(join(home, 'jetty.db'))
    db.exec('PRAGMA busy_timeout = 400')
    db.exec(
      `INSERT INTO settings (key, value_json) VALUES ('cleanShutdown', 'true') ON CONFLICT(key) DO UPDATE SET value_json = 'true'`
    )
  } catch {
    // This exit then counts toward the restart limit.
  } finally {
    db?.close()
  }
}

// One server per home: a second one would settle the first one's live turns as if it had crashed.
// SQLite's lock on the file is the OS's, so it goes with the process however that ends; with the
// journal in memory, a killed server leaves no journal file behind either.
function lockHome(home: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(home, { recursive: true })
    return yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const lock = new Database(join(home, 'server.lock'))
          try {
            lock.exec('PRAGMA journal_mode = MEMORY')
            lock.exec('BEGIN EXCLUSIVE')
          } catch (error) {
            lock.close()
            throw error
          }
          return lock
        },
        catch: (error) =>
          new Error(
            (error as { code?: string }).code === 'SQLITE_BUSY'
              ? `Another Jetty server is already using ${home}. Stop it first, or set JETTY_HOME to another folder.`
              : `Couldn't lock ${home}: ${error}`
          ),
      }),
      (lock) => Effect.sync(() => lock.close())
    )
  })
}

function reconcileOnStartup(store: Store) {
  return Effect.gen(function* () {
    const starts = yield* store.recordServerStart(Date.now(), RESTART_WINDOW_MS)
    const autoResume = starts < RESTART_LIMIT
    for (const thread of yield* store.listThreads()) {
      const state = yield* store.getThreadState(thread.id)
      const stoppedNames: string[] = []
      yield* store.transaction(
        Effect.gen(function* () {
          for (const item of state.items)
            if (
              (item.kind === 'subagent' || item.kind === 'workflow') &&
              item.status === 'running'
            ) {
              stoppedNames.push(item.kind === 'workflow' ? item.name : item.title)
              yield* store.appendEvent(thread.id, {
                type: 'item.completed',
                itemId: item.id,
                patch:
                  item.kind === 'workflow'
                    ? { status: 'stopped', stopReason: 'crash' }
                    : { status: 'stopped' },
              })
            }
          // A turn that ended waiting on stopped background work was cut short too.
          const cutTurnId =
            state.activeTurnId ??
            (stoppedNames.length && !thread.archived ? state.items.at(-1)?.turnId : undefined)
          // A note an earlier start queued to resume its cut turn, and never sent, still counts
          // towards the restart limit.
          const unsent = (thread.pendingMessages ?? []).filter(
            (message) => message.kind === 'continuation'
          )
          const turnId = cutTurnId ?? (unsent.length ? state.items.at(-1)?.turnId : undefined)
          if (!turnId) return
          if (!autoResume) {
            yield* store.setQueuePaused(thread.id, true)
            // Resume queues the note afresh, for the turn it holds.
            for (const message of unsent) yield* store.editQueued(thread.id, message.id)
          }
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
          if (state.activeTurnId)
            yield* store.appendEvent(thread.id, {
              type: 'turn.failed',
              turnId: state.activeTurnId,
              error: 'server_restarted',
            })
          if (!autoResume && (state.activeTurnId || !heldByRestarts(state.items)))
            yield* store.appendEvent(thread.id, {
              type: 'item.started',
              item: {
                id: newId(),
                turnId,
                createdAt: Date.now(),
                kind: 'error',
                message: RESTART_LIMIT_NOTE,
              },
            })
          if (autoResume && !thread.archived && cutTurnId)
            yield* store.enqueue(
              thread.id,
              yield* store.continuation(thread.id, cutTurnId, stoppedNames),
              0
            )
        })
      )
    }
    yield* store.stoppedBackground()
  })
}

// base64 inflates by 4/3; the extra MiB covers the rest of the turn.start frame.
const MAX_TURN_PAYLOAD_BYTES = Math.ceil((MAX_TURN_IMAGE_BYTES * 4) / 3) + 1024 * 1024

const distDir = resolve(import.meta.dir, '../../client/dist')

// No page may frame Jetty: a framed PR view could have its Merge button clickjacked.
const appPageHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
}

function appPage(html: string) {
  return HttpServerResponse.html(html).pipe(HttpServerResponse.setHeaders(appPageHeaders))
}

function serveStatic(pathname: string, wsSecret: string, localPeer: boolean) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const indexPath = join(distDir, 'index.html')
    const secretTag = `<meta name="jetty-ws-secret" content="${wsSecret}">`
    if (!(yield* fs.exists(indexPath)))
      return localPeer ? appPage(secretTag) : HttpServerResponse.text('Forbidden', { status: 403 })
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
      return appPage(html.replace('</head>', `${secretTag}</head>`))
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

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

// Private GitHub media is only for Jetty's own pages: no cross-site embeds, no rebound hostnames.
function ownPageRequest(headers: Record<string, string | undefined>) {
  const site = headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  try {
    const { host, hostname } = new URL(`http://${headers.host}`)
    return (
      loopbackHosts.has(hostname) ||
      [...extraOrigins].some((origin) => URL.canParse(origin) && new URL(origin).host === host)
    )
  } catch {
    return false
  }
}

const githubMediaHeaders = {
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  // An SVG opened on its own renders inert instead of running script on Jetty's origin.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
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

    yield* lockHome(home)
    const database = yield* Layer.build(storeLayer.pipe(Layer.provide(databaseLayer(home))))
    const store = Context.get(database, Store)
    yield* reconcileOnStartup(store)
    const hub = createHub()
    const worktrees = createWorktrees(store, home, (thread) =>
      hub.pushChrome({ type: 'thread.upserted', thread })
    )
    yield* Effect.promise(() => worktrees.reconcile())
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
    yield* store.heldAttachments().pipe(
      Effect.flatMap(attachments.sweep),
      Effect.catchCause((cause) => Effect.logWarning(cause))
    )
    const pullRequests = createPullRequests(store, hub)
    const githubMedia = createGithubMedia(home)
    const perfSink = createPerfSink(home)
    const mcp = createMcpSessions()
    const hooks: AgentHooks = {
      onBackgroundTasks(threadId, tasks) {
        return hub
          .withChromePublication(
            Effect.gen(function* () {
              hub.setBackgroundTasks(threadId, tasks)
              if (tasks.length) yield* store.noteLiveBackground(threadId)
              else yield* store.clearLiveBackground(threadId)
              const thread = yield* store.requireThread(threadId)
              hub.pushChrome({ type: 'thread.upserted', thread })
              yield* Queue.offer(store.queueChanges, undefined)
            })
          )
          .pipe(Effect.ignore)
      },
      onUsage: noteClaudeTurnUsage,
    }
    const discovers = typeof agentKind === 'string' && agentKind !== 'echo'
    let models: readonly ProviderModel[] | null = agentKind === 'echo' ? ECHO_MODELS : null
    let modelDiscovery: ModelDiscovery = discovers
      ? { claude: 'loading', codex: 'loading', grok: 'loading' }
      : { claude: 'ready', codex: 'ready', grok: 'ready' }
    let registerClaudeMcp:
      | ((
          server: McpSdkServerConfigWithInstance['instance'],
          identity: { threadId: string; provider: 'claude' }
        ) => Promise<void>)
      | undefined
    const registry =
      typeof agentKind !== 'string'
        ? singleAgentRegistry(agentKind)
        : agentKind === 'echo'
          ? singleAgentRegistry(yield* loadAgent(echoLayer(hooks)))
          : agentRegistry(
              {
                claude: yield* loadAgent(
                  claudeLayer(store, hooks, {
                    mcp: async (identity) => {
                      if (!registerClaudeMcp) throw new Error('Jetty MCP is not ready')
                      const server = createSdkMcpServer({ name: 'jetty', version: '1.0.0' })
                      await registerClaudeMcp(server.instance, identity)
                      return server
                    },
                    supportsAutoMode: (id) =>
                      findProviderModel(models ?? [], 'claude', id)?.autoMode !== false,
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
          if (!discovers) return Effect.void
          if (!force && Date.now() - lastDiscovery < 60_000) return Effect.void
          lastDiscovery = Date.now()
          const done = Deferred.makeUnsafe<void>()
          inFlight = done
          const lists = new Map<ProviderId, readonly ProviderModel[]>(
            (['claude', 'codex', 'grok'] as const).map((provider) => [
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
          function publishStatus() {
            return hub.withChromePublication(
              Effect.sync(() => hub.pushChrome({ type: 'modelDiscovery', status: modelDiscovery }))
            )
          }
          modelDiscovery = { claude: 'loading', codex: 'loading', grok: 'loading' }
          function probe<E, R>(
            provider: ProviderId,
            discovery: Effect.Effect<readonly ProviderModel[], E, R>
          ) {
            return discovery.pipe(
              Effect.tapError((error) =>
                Effect.logWarning(`${provider} model discovery failed: ${error}`)
              ),
              Effect.match({
                onFailure: () => ({ provider, models: null }),
                onSuccess: (models) => ({ provider, models }),
              })
            )
          }
          const probes = [
            probe('claude', discoverClaudeModels()),
            probe('codex', discoverCodexModels(home, opts.codex)),
            probe('grok', discoverGrokModels(home, opts.grok)),
          ]
          return publishStatus()
            .pipe(
              Effect.andThen(
                Effect.all(
                  probes.map((discovery) =>
                    discovery.pipe(
                      Effect.flatMap(({ provider, models: next }) => {
                        if (next) lists.set(provider, next)
                        modelDiscovery = {
                          ...modelDiscovery,
                          [provider]: next ? 'ready' : 'error',
                        }
                        return publish().pipe(Effect.andThen(publishStatus()))
                      })
                    )
                  ),
                  { concurrency: 'unbounded', discard: true }
                )
              )
            )
            .pipe(
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
    function modelCatalog() {
      return Effect.gen(function* () {
        if (models === null) yield* refreshModels()
        else yield* refreshModels().pipe(Effect.forkIn(discoveryScope))
        return models ?? []
      })
    }
    const titlePrompt = yield* createTitlePrompt({
      codex: opts.codex,
      grok: opts.grok,
      catalog: modelCatalog,
      choice: () => store.getTitleModel().pipe(Effect.orElseSucceed(() => ({ model: null }))),
    })
    const titler = selectTitler(agentKind, opts, titlePrompt)
    const pullRequestLinks = createPullRequestLinks(store, hub, pullRequests, discoveryScope)
    const services = yield* Layer.build(
      orchestratorLayer({
        store,
        hub,
        titler,
        attachments,
        agent: registry,
        onPullRequestOutput: pullRequestLinks.linkFound,
        modelCatalog,
        knownModels: () => models ?? [],
        worktrees,
      })
    )
    const orch = Context.get(services, OrchestratorService)
    // The watcher sees every read, the sweep's first included.
    const pullRequestWatch = createPullRequestWatch(store, orch)
    pullRequests.observe(pullRequestWatch)
    yield* pullRequestWatch.resume
    yield* Effect.gen(function* () {
      const watching = (yield* store.getAgentBehaviours()).watchPullRequests
      if (watching || (yield* hub.subscriberCount) > 0)
        yield* pullRequests.refreshChangedLinks(watching)
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning(cause)),
      Effect.repeat(Schedule.spaced('5 seconds')),
      Effect.forkIn(discoveryScope)
    )
    const admissionScope = yield* Scope.fork(yield* Effect.scope)
    const handlers = yield* createRpcHandlers(
      store,
      orch,
      hub,
      () => models,
      refreshModels,
      pullRequests,
      worktrees,
      () => modelDiscovery,
      (provider) => {
        if (agentKind === 'echo') return Effect.succeed(echoUsage(provider))
        if (provider === 'codex')
          return readCodexProviderUsage(home, opts.codex).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
          )
        return Effect.promise(() =>
          provider === 'grok' ? readGrokProviderUsage() : readClaudeProviderUsage()
        )
      }
    ).pipe(Effect.provideService(Scope.Scope, admissionScope), Effect.provideContext(io))
    const transportScope = yield* Scope.fork(yield* Effect.scope)
    const http = yield* Layer.build(
      BunHttpServer.layer({
        port,
        hostname,
        disablePreemptiveShutdown: true,
        websocket: { maxPayloadLength: MAX_TURN_PAYLOAD_BYTES, perMessageDeflate: true },
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
      pullRequestLinks,
      (threadId) => handlers['thread.archive']({ threadId, archived: true }),
      worktrees
    )
    registerClaudeMcp = handleMcp.register
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, 'http://localhost')
      const peer = request.remoteAddress
      const localPeer =
        peer && Option.isSome(peer) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer.value)
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
      if (url.pathname === '/perf') {
        if (!originAllowed(request.headers.origin))
          return HttpServerResponse.text('Forbidden origin', { status: 403 })
        if (request.method !== 'POST')
          return HttpServerResponse.text('Method not allowed', { status: 405 })
        const web = yield* HttpServerRequest.toWeb(request)
        return HttpServerResponse.fromWeb(yield* Effect.promise(() => perfSink(web)))
      }
      if (request.method === 'GET' && url.pathname.startsWith('/attachments/')) {
        const id = url.pathname.slice('/attachments/'.length)
        const resolved = yield* attachments.resolve(id)
        if (!resolved) return HttpServerResponse.text('Not found', { status: 404 })
        return yield* rangeResponse(resolved.path, resolved.mimeType, request.headers.range ?? null)
      }
      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        url.pathname === '/github-media'
      ) {
        if (!localPeer || !ownPageRequest(request.headers))
          return HttpServerResponse.text('Forbidden', { status: 403 })
        const media = yield* Effect.promise(() =>
          githubMedia.resolve(url.searchParams.get('url') ?? '')
        )
        if (media instanceof GithubMediaError)
          return HttpServerResponse.text(media.message, { status: media.status })
        return yield* rangeResponse(
          media.path,
          media.mimeType,
          request.headers.range ?? null,
          githubMediaHeaders
        )
      }
      return yield* serveStatic(url.pathname, wsSecret, !!localPeer)
    }).pipe(
      Effect.catch(() => Effect.succeed(HttpServerResponse.text('Not found', { status: 404 }))),
      Effect.interruptible
    )
    yield* server
      .serve(app)
      .pipe(Effect.provideContext(http), Effect.provideService(Scope.Scope, transportScope))
    if (!NetAddress.isInetAddress(server.address)) {
      return yield* Effect.fail(new Error('server failed to bind a TCP port'))
    }
    const bound = {
      port: server.address.port,
      hostname: NetAddress.formatIp(server.address.address),
    }
    mcp.setUrl(
      `http://${bound.hostname.includes(':') ? `[${bound.hostname}]` : bound.hostname}:${bound.port}/mcp`
    )
    yield* orch.resumeQueues()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => markCleanShutdown(home)).pipe(
        Effect.andThen(orch.beginShutdown()),
        Effect.andThen(Effect.promise(() => worktrees.shutdown()))
      )
    )

    return {
      home,
      ...bound,
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
  const home = process.env.JETTY_HOME ?? join(homedir(), '.jetty')
  const mark = () => markCleanShutdown(home)
  process.on('SIGTERM', mark)
  process.on('SIGINT', mark)
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

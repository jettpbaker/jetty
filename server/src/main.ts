import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'

import type { Titler } from './titler'

import { createEchoAdapter, type Agent } from './agent'
import { createClaudeAdapter } from './claude'
import { createClaudeTitler } from './claude-titler'
import { openDb } from './db'
import { createHub, type ConnData } from './hub'
import { createOrchestrator } from './orchestrator'
import { createStore, type Store } from './store'
import { createWs } from './ws'

export type ServerOptions = {
  home?: string
  port?: number
  hostname?: string
  /** Override agent selection (defaults to JETTY_AGENT env, then 'claude'). */
  agent?: 'echo' | 'claude'
  /** Override titler (defaults to real titler for claude, null for echo). */
  titler?: Titler | null
}

function selectAgent(kind: 'echo' | 'claude', store: Store): Agent {
  return kind === 'echo' ? createEchoAdapter() : createClaudeAdapter(store)
}

function selectTitler(kind: 'echo' | 'claude'): Titler | null {
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

export function startServer(opts: ServerOptions = {}) {
  const home = opts.home ?? process.env.JETTY_HOME ?? join(homedir(), '.jetty')
  const port = opts.port ?? Number(process.env.PORT ?? 8787)
  const hostname = opts.hostname ?? process.env.HOST ?? '127.0.0.1'
  const agentKind = opts.agent ?? (process.env.JETTY_AGENT === 'echo' ? 'echo' : 'claude')

  const db = openDb(home)
  const store = createStore(db)
  reconcileOnStartup(store)

  const agent = selectAgent(agentKind, store)
  const hub = createHub()
  const titler = opts.titler !== undefined ? opts.titler : selectTitler(agentKind)
  const orch = createOrchestrator(store, agent, hub, titler)
  const ws = createWs(store, orch, hub)

  const server = Bun.serve<ConnData>({
    port,
    hostname,
    async fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname === '/ws') {
        if (server.upgrade(req, { data: { chrome: false, threads: new Set() } })) {
          return undefined
        }
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      return serveStatic(url.pathname)
    },
    websocket: ws.handlers,
  })

  const boundPort = server.port
  if (boundPort === undefined) throw new Error('server failed to bind a port')

  return {
    server,
    home,
    port: boundPort,
    hostname: server.hostname,
    store,
    agent,
    stop() {
      server.stop(true)
      db.close()
    },
  }
}

if (import.meta.main) {
  const running = startServer()
  console.log(`jetty listening on http://${running.hostname}:${running.port}`)
  console.log(`websocket at ws://${running.hostname}:${running.port}/ws`)

  const shutdown = () => {
    console.log('shutting down…')
    for (const thread of running.store.listThreads()) {
      running.agent.interrupt(thread.id, 'server shutdown')
    }
    running.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

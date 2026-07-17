import { homedir } from 'node:os'
import { join } from 'node:path'

import { createEchoAdapter, type Agent } from './agent'
import { createClaudeAdapter } from './claude'
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
}

function selectAgent(kind: 'echo' | 'claude', store: Store): Agent {
  return kind === 'echo' ? createEchoAdapter() : createClaudeAdapter(store)
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
  const orch = createOrchestrator(store, agent, hub)
  const ws = createWs(store, orch, hub)

  const server = Bun.serve<ConnData>({
    port,
    hostname,
    fetch(req, server) {
      if (server.upgrade(req, { data: { chrome: false, threads: new Set() } })) {
        return undefined
      }
      return new Response('jetty', { status: 200 })
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
  console.log(`jetty listening on ws://${running.hostname}:${running.port}`)

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

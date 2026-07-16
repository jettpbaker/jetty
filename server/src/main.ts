import { homedir } from 'node:os'
import { join } from 'node:path'

import { EchoAgent } from './agent'
import { openDb } from './db'
import { createHub, type ConnData } from './hub'
import { createOrchestrator } from './orchestrator'
import { createStore } from './store'
import { createWs } from './ws'

export type ServerOptions = {
  home?: string
  port?: number
  hostname?: string
}

export function startServer(opts: ServerOptions = {}) {
  const home = opts.home ?? process.env.JETTY_HOME ?? join(homedir(), '.jetty')
  const port = opts.port ?? Number(process.env.PORT ?? 8787)
  const hostname = opts.hostname ?? process.env.HOST ?? '127.0.0.1'

  const db = openDb(home)
  const store = createStore(db)
  const agent = new EchoAgent()

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
    stop() {
      server.stop(true)
      db.close()
    },
  }
}

if (import.meta.main) {
  const { port, hostname } = startServer()
  console.log(`jetty listening on ws://${hostname}:${port}`)
}

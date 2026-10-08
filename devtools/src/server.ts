import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { StreamMessage } from './wire'

import index from './index.html'
import { createBotSource, listBots } from './sources'

const POLL_MS = 300

const jettyHome = process.env.JETTY_HOME ?? join(homedir(), '.jetty')
const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
const port = Number(process.env.JETTY_DEVTOOLS_PORT ?? 8790)

const db = new Database(join(jettyHome, 'jetty.db'), { readonly: true })

function stream(request: Request) {
  const botId = new URL(request.url).searchParams.get('bot')
  const source = botId && createBotSource(db, botId, { jettyHome, claudeHome })
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setInterval> | undefined

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (message: StreamMessage) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
      const snapshot = source ? await source.snapshot() : null
      if (!source || !snapshot) {
        send({ type: 'error', message: `No bot ${botId ?? ''} in ${jettyHome}` })
        controller.close()
        return
      }
      send(snapshot)
      let polling = false
      timer = setInterval(async () => {
        if (polling) return
        polling = true
        try {
          const append = await source.poll()
          if (append) send(append)
        } catch (error) {
          send({ type: 'error', message: String(error) })
        } finally {
          polling = false
        }
      }, POLL_MS)
      request.signal.addEventListener('abort', () => {
        clearInterval(timer)
        controller.close()
      })
    },
    cancel() {
      clearInterval(timer)
    },
  })
  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  development: true,
  routes: {
    '/': index,
    '/api/bots': () => Response.json(listBots(db)),
    '/api/stream': (request, server) => {
      server.timeout(request, 0)
      return stream(request)
    },
  },
})

console.log(`Jetty devtools on ${server.url} (reading ${jettyHome})`)

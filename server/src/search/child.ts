import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Request, Reply } from './protocol'

import { gemmaEmbedder, selfCheckEmbeddingGemma } from './embed'
import { recall, reindex } from './lib'
import { recallThreads, reindexThreads, threadCursors } from './threads'

const home = process.env.JETTY_HOME!
let pending = Promise.resolve()
let requests = 0
let idle: ReturnType<typeof setTimeout> | undefined
function send(reply: Reply) {
  process.send?.(reply)
}
function armIdle() {
  clearTimeout(idle)
  if (requests) return
  idle = setTimeout(() => process.exit(0), 5 * 60_000)
}
process.on('disconnect', () => process.exit(0))
// IPC disconnect delivery can lag while native model work is running.
const parentPid = process.ppid
setInterval(() => {
  if (process.ppid !== parentPid || process.ppid === 1) process.exit(0)
}, 1000).unref()

const ready = (async () => {
  await mkdir(join(home, 'search'), { recursive: true })
  const scores = await selfCheckEmbeddingGemma()
  console.error(
    `[search] self-check passed: ${scores.join(', ')} pid=${process.pid} rss=${process.memoryUsage().rss}`
  )
  send({ type: 'ready' })
  armIdle()
})()
ready.catch((error) => {
  send({
    type: 'loadError',
    error: String(error instanceof Error ? error.message : error).split('\n')[0]!,
  })
  armIdle()
})
process.on('message', (request: Request) => {
  requests++
  clearTimeout(idle)
  pending = pending.then(async () => {
    try {
      await ready
      const path = join(home, 'search', `${request.botId}.sqlite`)
      if (request.kind === 'cursors') {
        send({ type: 'result', id: request.id, result: threadCursors(path, gemmaEmbedder.id) })
      } else if (request.kind === 'wiki') {
        const started = performance.now()
        const stats = await reindex(request.home, path, { embed: gemmaEmbedder })
        console.error(
          `[search wiki] embedded=${stats.embedded} unchanged=${stats.unchanged} removed=${stats.removed} chunks=${stats.chunks} ms=${Math.round(performance.now() - started)}`
        )
        send({
          type: 'result',
          id: request.id,
          result: await recall(path, request.query, request.k, { embed: gemmaEmbedder }),
        })
      } else {
        await reindexThreads(path, request.scope, request.updates, gemmaEmbedder)
        send({
          type: 'result',
          id: request.id,
          result: await recallThreads(path, request.query, request.k, gemmaEmbedder),
        })
      }
    } catch (error) {
      send({
        type: 'result',
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
  void pending.then(() => {
    requests--
    armIdle()
  })
})

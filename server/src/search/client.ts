import { join } from 'node:path'

import type { Request, Reply } from './protocol'

type Payload = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never
export function createSearchClient(home: string) {
  let child: ReturnType<typeof Bun.spawn> | undefined
  let readiness: Promise<void> | undefined
  let reason = 'its model is still downloading (0% of 316 MB)'
  let sequence = 0
  const waiting = new Map<
    number,
    {
      resolve: (value: NonNullable<Extract<Reply, { type: 'result' }>['result']>) => void
      reject: (error: Error) => void
    }
  >()
  function start() {
    if (child) return
    let resolveReady: () => void
    let rejectReady: (error: Error) => void
    reason = 'its model is still downloading (0% of 316 MB)'
    readiness = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void readiness.catch(() => {})
    const spawned = Bun.spawn([process.execPath, join(import.meta.dir, 'child.ts')], {
      env: { ...process.env, JETTY_HOME: home },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'inherit',
      ipc(message: Reply) {
        if (message.type === 'ready') resolveReady()
        else if (message.type === 'progress')
          reason = `its model is still downloading (${message.percent}% of 316 MB)`
        else if (message.type === 'loadError') {
          reason = message.error
          rejectReady(new Error(reason))
          spawned.kill()
        } else {
          const waiter = waiting.get(message.id)
          waiting.delete(message.id)
          if (message.error) waiter?.reject(new Error(message.error))
          else if (message.result) waiter?.resolve(message.result)
        }
      },
    })
    child = spawned
    void spawned.exited.then(() => {
      if (child !== spawned) return
      child = undefined
      rejectReady(new Error('search process exited'))
      for (const waiter of waiting.values()) waiter.reject(new Error('search process exited'))
      waiting.clear()
    })
  }
  async function request(payload: Payload) {
    start()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        readiness!,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(reason)), 60_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    const id = ++sequence
    return new Promise<NonNullable<Extract<Reply, { type: 'result' }>['result']>>(
      (resolve, reject) => {
        waiting.set(id, { resolve, reject })
        try {
          child!.send({ ...payload, id })
        } catch (error) {
          waiting.delete(id)
          reject(error)
        }
      }
    )
  }
  async function stop() {
    const running = child
    if (running) {
      running.kill()
      await running.exited
    }
  }
  return { request, stop }
}
export type SearchClient = ReturnType<typeof createSearchClient>

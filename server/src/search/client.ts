import { join } from 'node:path'

import type { Request, Reply } from './protocol'

type Payload = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never
export function createSearchClient(home: string) {
  let child: ReturnType<typeof Bun.spawn> | undefined
  let readiness: Promise<void> | undefined
  let readyWait: Promise<void> | undefined
  let notReady = false
  let resetChild: ((error: Error) => void) | undefined
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
    notReady = false
    readiness = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void readiness.catch(() => {})
    let lastProgress = Date.now()
    let stallTimer: ReturnType<typeof setTimeout>
    function armStall() {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        if (Date.now() - lastProgress >= 60_000) reset(new Error(reason))
        else armStall()
      }, 60_000)
    }
    let readyTimer: ReturnType<typeof setTimeout>
    readyWait = Promise.race([
      readiness,
      new Promise<never>((_, reject) => {
        readyTimer = setTimeout(() => {
          notReady = true
          reject(new Error(reason))
        }, 60_000)
      }),
    ])
    void readyWait.catch(() => {})
    const spawned = Bun.spawn([process.execPath, join(import.meta.dir, 'child.ts')], {
      env: { ...process.env, JETTY_HOME: home },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'inherit',
      ipc(message: Reply) {
        if (child !== spawned) return
        if (message.type === 'ready') {
          clearTimeout(stallTimer)
          clearTimeout(readyTimer)
          notReady = false
          resolveReady()
          readyWait = readiness
        } else if (message.type === 'progress') {
          lastProgress = Date.now()
          armStall()
          reason = `its model is still downloading (${message.percent}% of 316 MB)`
        } else if (message.type === 'loadError') {
          reason = message.error
          reset(new Error(reason))
        } else {
          const waiter = waiting.get(message.id)
          waiting.delete(message.id)
          if (message.error) waiter?.reject(new Error(message.error))
          else if (message.result) waiter?.resolve(message.result)
        }
      },
    })
    child = spawned
    function reset(error: Error) {
      if (child !== spawned) return
      clearTimeout(stallTimer)
      clearTimeout(readyTimer)
      child = undefined
      readiness = undefined
      readyWait = undefined
      resetChild = undefined
      rejectReady(error)
      for (const waiter of waiting.values()) waiter.reject(error)
      waiting.clear()
      spawned.kill()
    }
    resetChild = reset
    armStall()
    void spawned.exited.then(() => {
      reset(new Error('search process exited'))
    })
  }
  function ready() {
    start()
    return notReady ? Promise.reject(new Error(reason)) : readyWait!
  }
  async function request(payload: Payload) {
    const prepared = ready()
    const running = child!
    await prepared
    if (child !== running) throw new Error('search process exited')
    const id = ++sequence
    return new Promise<NonNullable<Extract<Reply, { type: 'result' }>['result']>>(
      (resolve, reject) => {
        waiting.set(id, { resolve, reject })
        try {
          running.send({ ...payload, id })
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
      resetChild?.(new Error('search process stopped'))
      await running.exited
    }
  }
  return { ready, request, stop }
}
export type SearchClient = ReturnType<typeof createSearchClient>

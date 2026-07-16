import type { PushMessage, ResponseMessage, ServerMessage } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startServer } from './main'

type Running = ReturnType<typeof startServer>

const servers: Running[] = []
const homes: string[] = []

function boot() {
  const home = mkdtempSync(join(tmpdir(), 'jetty-test-'))
  homes.push(home)
  const running = startServer({ home, port: 0, hostname: '127.0.0.1' })
  servers.push(running)
  return running
}

afterEach(() => {
  while (servers.length) servers.pop()?.stop()
  while (homes.length) {
    const home = homes.pop()
    if (home) rmSync(home, { recursive: true, force: true })
  }
})

type Client = {
  ws: WebSocket
  close: () => void
  request: <T = unknown>(method: string, params: unknown) => Promise<T>
  waitFor: (pred: (msg: ServerMessage) => boolean, ms?: number) => Promise<ServerMessage>
  messages: ServerMessage[]
}

function connect(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    const messages: ServerMessage[] = []
    const waiters: Array<{
      pred: (msg: ServerMessage) => boolean
      resolve: (msg: ServerMessage) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }> = []

    const client: Client = {
      ws,
      messages,
      close: () => ws.close(),
      request<T>(method: string, params: unknown) {
        const id = newId()
        return new Promise<T>((res, rej) => {
          pending.set(id, {
            resolve: (v) => res(v as T),
            reject: rej,
          })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },
      waitFor(pred, ms = 5000) {
        for (const msg of messages) {
          if (pred(msg)) return Promise.resolve(msg)
        }
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const i = waiters.findIndex((w) => w.resolve === res)
            if (i >= 0) waiters.splice(i, 1)
            rej(new Error('waitFor timed out'))
          }, ms)
          waiters.push({ pred, resolve: res, reject: rej, timer })
        })
      },
    }

    ws.addEventListener('open', () => resolve(client))
    ws.addEventListener('error', () => reject(new Error('websocket error')))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage
      messages.push(msg)

      if ('ok' in msg && typeof msg.id === 'string') {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          if (msg.ok) p.resolve(msg.result)
          else p.reject(new Error(`${msg.error?.code}: ${msg.error?.message}`))
        }
      }

      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i]!
        if (w.pred(msg)) {
          clearTimeout(w.timer)
          waiters.splice(i, 1)
          w.resolve(msg)
        }
      }
    })
  })
}

function isThreadPush(msg: ServerMessage): msg is Extract<PushMessage, { sub: 'thread' }> {
  return 'sub' in msg && msg.sub === 'thread'
}

function threadEvents(client: Client, threadId: string) {
  return client.messages.filter(
    (m): m is Extract<PushMessage, { sub: 'thread' }> => isThreadPush(m) && m.threadId === threadId
  )
}

describe('server skeleton', () => {
  test('create project → thread → subscribe → turn.start streams events', async () => {
    const { port } = boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string; path: string } }>(
      'project.create',
      { path: '/tmp/demo', title: 'Demo' }
    )
    expect(project.path).toBe('/tmp/demo')

    const { thread } = await c.request<{ thread: { id: string; projectId: string } }>(
      'thread.create',
      { projectId: project.id }
    )
    expect(thread.projectId).toBe(project.id)

    const sub = await c.request<{ snapshot: { items: unknown[]; lastSeq: number }; seq: number }>(
      'thread.subscribe',
      { threadId: thread.id }
    )
    expect(sub.seq).toBe(0)
    expect(sub.snapshot.lastSeq).toBe(0)
    expect(sub.snapshot.items).toEqual([])

    const { turnId } = await c.request<{ turnId: string }>('turn.start', {
      threadId: thread.id,
      text: 'hello',
    })
    expect(turnId).toBeTruthy()

    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    const events = threadEvents(c, thread.id).map((m) => m.event)
    const types = events.map((e) => e.type)

    expect(types[0]).toBe('item.started') // user_message
    expect(types).toContain('turn.started')
    expect(types).toContain('item.delta')
    expect(types).toContain('turn.completed')

    const userStart = events.find(
      (e) => e.type === 'item.started' && e.item.kind === 'user_message'
    )
    expect(userStart).toMatchObject({
      type: 'item.started',
      item: { kind: 'user_message', text: 'hello', turnId },
    })

    const toolStart = events.find((e) => e.type === 'item.started' && e.item.kind === 'tool_call')
    expect(toolStart).toMatchObject({
      type: 'item.started',
      item: { kind: 'tool_call', toolName: 'echo', status: 'running' },
    })

    const toolDone = events.find(
      (e) =>
        e.type === 'item.completed' &&
        e.patch &&
        (e.patch as { status?: string }).status === 'succeeded'
    )
    expect(toolDone).toBeTruthy()

    const completed = events.find((e) => e.type === 'turn.completed')
    expect(completed).toMatchObject({
      type: 'turn.completed',
      turnId,
      usage: { inputTokens: 5, outputTokens: 5 },
    })

    // seqs are contiguous from 1
    const seqs = threadEvents(c, thread.id).map((m) => m.seq)
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))

    // cold snapshot has the full projected state
    const c2 = await connect(port)
    const again = await c2.request<{
      snapshot: {
        items: Array<{ kind: string; text?: string; output?: string; status?: string }>
        status: string
        lastSeq: number
      }
      seq: number
    }>('thread.subscribe', { threadId: thread.id })
    expect(again.snapshot.status).toBe('idle')
    expect(seqs.length).toBeGreaterThan(0)
    expect(again.snapshot.lastSeq).toBe(seqs[seqs.length - 1]!)
    const assistant = again.snapshot.items.find((i) => i.kind === 'assistant_message')
    expect(assistant?.text).toBe('hello')
    const tool = again.snapshot.items.find((i) => i.kind === 'tool_call')
    expect(tool?.status).toBe('succeeded')
    expect(tool?.output).toBe('echo: hello')

    c.close()
    c2.close()
  })

  test('reconnect with afterSeq replays the gap', async () => {
    const { port } = boot()
    const c1 = await connect(port)

    const { project } = await c1.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/gap',
    })
    const { thread } = await c1.request<{ thread: { id: string } }>('thread.create', {
      projectId: project.id,
    })
    await c1.request('thread.subscribe', { threadId: thread.id })
    await c1.request('turn.start', { threadId: thread.id, text: 'gap-test' })
    await c1.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    const all = threadEvents(c1, thread.id)
    const lastSeq = all.at(-1)!.seq
    const mid = Math.floor(lastSeq / 2)
    expect(mid).toBeGreaterThan(0)

    const c2 = await connect(port)
    const before = c2.messages.length
    const result = await c2.request<{ seq: number; snapshot?: unknown }>('thread.subscribe', {
      threadId: thread.id,
      afterSeq: mid,
    })
    expect(result.seq).toBe(lastSeq)
    expect(result.snapshot).toBeUndefined()

    // replayed pushes land before or around the response; collect from all messages
    await c2.waitFor((m) => isThreadPush(m) && m.threadId === thread.id && m.seq === lastSeq, 2000)

    const replayed = c2.messages
      .slice(before)
      .filter((m): m is Extract<PushMessage, { sub: 'thread' }> => isThreadPush(m))
      .filter((m) => m.threadId === thread.id)

    expect(replayed.map((m) => m.seq)).toEqual(all.filter((m) => m.seq > mid).map((m) => m.seq))
    expect(replayed[0]?.event).toEqual(all.find((m) => m.seq === mid + 1)?.event)

    c1.close()
    c2.close()
  })

  test('two clients both receive fan-out', async () => {
    const { port } = boot()
    const a = await connect(port)
    const b = await connect(port)

    const { project } = await a.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/fan',
    })
    const { thread } = await a.request<{ thread: { id: string } }>('thread.create', {
      projectId: project.id,
    })

    await a.request('thread.subscribe', { threadId: thread.id })
    await b.request('thread.subscribe', { threadId: thread.id })

    await a.request('turn.start', { threadId: thread.id, text: 'fanout' })

    await Promise.all([
      a.waitFor(
        (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
      ),
      b.waitFor(
        (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
      ),
    ])

    const aTypes = threadEvents(a, thread.id).map((m) => m.event.type)
    const bTypes = threadEvents(b, thread.id).map((m) => m.event.type)
    expect(aTypes).toEqual(bTypes)
    expect(aTypes).toContain('turn.started')
    expect(aTypes).toContain('turn.completed')

    const aSeqs = threadEvents(a, thread.id).map((m) => m.seq)
    const bSeqs = threadEvents(b, thread.id).map((m) => m.seq)
    expect(aSeqs).toEqual(bSeqs)

    a.close()
    b.close()
  })

  test('invalid request gets an error response', async () => {
    const { port } = boot()
    const c = await connect(port)

    // unknown method
    {
      const id = newId()
      const resP = new Promise<ResponseMessage>((resolve) => {
        const onMsg = (ev: MessageEvent) => {
          const msg = JSON.parse(String(ev.data)) as ServerMessage
          if ('ok' in msg && msg.id === id) {
            c.ws.removeEventListener('message', onMsg)
            resolve(msg)
          }
        }
        c.ws.addEventListener('message', onMsg)
      })
      c.ws.send(JSON.stringify({ id, method: 'nope.not.real', params: {} }))
      const res = await resP
      expect(res.ok).toBe(false)
      expect(res.error?.code).toBe('invalid_request')
    }

    // valid method, bad params
    {
      const id = newId()
      const resP = new Promise<ResponseMessage>((resolve) => {
        const onMsg = (ev: MessageEvent) => {
          const msg = JSON.parse(String(ev.data)) as ServerMessage
          if ('ok' in msg && msg.id === id) {
            c.ws.removeEventListener('message', onMsg)
            resolve(msg)
          }
        }
        c.ws.addEventListener('message', onMsg)
      })
      c.ws.send(JSON.stringify({ id, method: 'project.create', params: { path: 123 } }))
      const res = await resP
      expect(res.ok).toBe(false)
      expect(res.error?.code).toBe('invalid_params')
    }

    // not json — still should not crash the server
    c.ws.send('{{{')
    await c.request('project.create', { path: '/tmp/still-alive' })

    c.close()
  })

  test('turn_active while a turn is running', async () => {
    const { port } = boot()
    const c = await connect(port)
    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/busy',
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })
    await c.request('turn.start', { threadId: thread.id, text: 'first' })

    let err: Error | undefined
    try {
      await c.request('turn.start', { threadId: thread.id, text: 'second' })
    } catch (e) {
      err = e as Error
    }
    expect(err?.message).toMatch(/^turn_active:/)

    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )
    c.close()
  })
})

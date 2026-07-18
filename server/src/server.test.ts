import type { PushMessage, ResponseMessage, ServerMessage } from '@jetty/shared/wire'

import { MAX_IMAGE_BYTES, newId } from '@jetty/shared/wire'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Integration suite runs against the echo agent — no network, no tokens.
process.env.JETTY_AGENT = 'echo'

import type { Agent, AgentImage, TurnInput } from './agent'

import { openDb } from './db'
import { startServer } from './main'
import { createStore } from './store'

/** 1×1 PNG — tiny valid fixture for attachment tests. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const TINY_PNG_BYTES = Buffer.from(TINY_PNG_B64, 'base64')
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`

type Running = ReturnType<typeof startServer>

const servers: Running[] = []
const homes: string[] = []

function boot(opts: Parameters<typeof startServer>[0] = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jetty-test-'))
  homes.push(home)
  const running = startServer({ home, port: 0, hostname: '127.0.0.1', ...opts })
  servers.push(running)
  return running
}

function isChromePush(msg: ServerMessage): msg is Extract<PushMessage, { sub: 'chrome' }> {
  return 'sub' in msg && msg.sub === 'chrome'
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
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
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
      { id: newId(), projectId: project.id }
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
      id: newId(),
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
      id: newId(),
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

  test('steer: second turn.start mid-turn joins active turn', async () => {
    const { port } = boot()
    const c = await connect(port)
    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/busy',
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })

    const { turnId } = await c.request<{ turnId: string }>('turn.start', {
      threadId: thread.id,
      text: 'first',
    })

    // Wait until the agent has actually started the turn so steer has a live session.
    await c.waitFor(
      (m) =>
        isThreadPush(m) &&
        m.threadId === thread.id &&
        m.event.type === 'turn.started' &&
        m.event.turnId === turnId
    )

    const beforeTypes = threadEvents(c, thread.id).map((m) => m.event.type)
    const turnStartedCount = beforeTypes.filter((t) => t === 'turn.started').length

    const steered = await c.request<{ turnId: string }>('turn.start', {
      threadId: thread.id,
      text: 'second',
    })
    expect(steered.turnId).toBe(turnId)

    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    const events = threadEvents(c, thread.id).map((m) => m.event)
    const userItems = events.filter(
      (e) => e.type === 'item.started' && e.item.kind === 'user_message'
    )
    expect(userItems.length).toBeGreaterThanOrEqual(2)
    expect(userItems.every((e) => e.type === 'item.started' && e.item.turnId === turnId)).toBe(true)

    const turnStarted = events.filter((e) => e.type === 'turn.started')
    expect(turnStarted).toHaveLength(turnStartedCount)
    expect(turnStartedCount).toBe(1)

    c.close()
  })

  test('first turn on untitled thread pushes generated title', async () => {
    const titlerCalls: string[] = []
    const { port, store } = boot({
      agent: 'echo',
      titler: async (text) => {
        titlerCalls.push(text)
        return 'Fix the login bug'
      },
    })
    const c = await connect(port)
    await c.request('chrome.subscribe', {})

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/title-gen',
    })
    const { thread } = await c.request<{ thread: { id: string; title: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    expect(thread.title).toBe('New thread')

    await c.request('thread.subscribe', { threadId: thread.id })
    await c.request('turn.start', { threadId: thread.id, text: 'please fix login' })

    await c.waitFor(
      (m) =>
        isChromePush(m) &&
        m.data.type === 'thread.upserted' &&
        m.data.thread.id === thread.id &&
        m.data.thread.title === 'Fix the login bug'
    )

    expect(titlerCalls).toEqual(['please fix login'])
    expect(store.getThread(thread.id)?.title).toBe('Fix the login bug')

    c.close()
  })

  test('thread that already has a title never triggers titler', async () => {
    let called = false
    const { port, store } = boot({
      agent: 'echo',
      titler: async () => {
        called = true
        return 'Should not apply'
      },
    })
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/title-skip',
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    store.setThreadTitle(thread.id, 'Existing title')

    await c.request('thread.subscribe', { threadId: thread.id })
    await c.request('turn.start', { threadId: thread.id, text: 'hello' })
    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )
    // titler is sync-resolving but fire-and-forget; give it a tick
    await Bun.sleep(20)

    expect(called).toBe(false)
    expect(store.getThread(thread.id)?.title).toBe('Existing title')

    c.close()
  })

  test('titler returning null leaves title unchanged', async () => {
    let called = false
    const { port, store } = boot({
      agent: 'echo',
      titler: async () => {
        called = true
        return null
      },
    })
    const c = await connect(port)
    await c.request('chrome.subscribe', {})

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/title-null',
    })
    const { thread } = await c.request<{ thread: { id: string; title: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    expect(thread.title).toBe('New thread')

    await c.request('thread.subscribe', { threadId: thread.id })
    await c.request('turn.start', { threadId: thread.id, text: 'hello' })
    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )
    await Bun.sleep(20)

    expect(called).toBe(true)
    expect(store.getThread(thread.id)?.title).toBe('New thread')

    // No chrome push that renames the thread away from the placeholder
    const renamed = c.messages.some(
      (m) =>
        isChromePush(m) &&
        m.data.type === 'thread.upserted' &&
        m.data.thread.id === thread.id &&
        m.data.thread.title !== 'New thread'
    )
    expect(renamed).toBe(false)

    c.close()
  })

  test('startup reconciliation fails non-idle threads', async () => {
    const home = mkdtempSync(join(tmpdir(), 'jetty-reconcile-'))
    homes.push(home)

    const db = openDb(home)
    const store = createStore(db)
    const project = store.createProject('/tmp/reconcile', 'Reconcile')
    const thread = store.createThread(project.id, newId())
    store.appendEvent(thread.id, { type: 'turn.started', turnId: 'orphan-turn' })
    expect(store.getThreadState(thread.id).status).toBe('running')
    db.close()

    const running = startServer({ home, port: 0, hostname: '127.0.0.1', agent: 'echo' })
    servers.push(running)

    const c = await connect(running.port)
    const sub = await c.request<{
      snapshot: { status: string; activeTurnId: string | null; lastSeq: number }
      seq: number
    }>('thread.subscribe', { threadId: thread.id })

    expect(sub.snapshot.status).toBe('idle')
    expect(sub.snapshot.activeTurnId).toBeNull()
    expect(sub.snapshot.lastSeq).toBe(2)

    // Replay events to confirm turn.failed was appended
    const c2 = await connect(running.port)
    const before = c2.messages.length
    await c2.request('thread.subscribe', { threadId: thread.id, afterSeq: 0 })
    await c2.waitFor(
      (m) => isThreadPush(m) && m.threadId === thread.id && m.event.type === 'turn.failed',
      2000
    )
    const failed = c2.messages
      .slice(before)
      .filter(
        (m): m is Extract<PushMessage, { sub: 'thread' }> =>
          isThreadPush(m) && m.threadId === thread.id
      )
      .find((m) => m.event.type === 'turn.failed')
    expect(failed?.event).toMatchObject({
      type: 'turn.failed',
      turnId: 'orphan-turn',
      error: 'server restarted',
    })

    c.close()
    c2.close()
  })

  test('thread.create is idempotent for same id and projectId', async () => {
    const { port, store } = boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/idempotent',
    })
    const id = newId()

    const first = await c.request<{ thread: { id: string; title: string } }>('thread.create', {
      id,
      projectId: project.id,
    })
    expect(first.thread.id).toBe(id)
    expect(first.thread.title).toBe('New thread')

    store.setThreadTitle(id, 'Renamed after create')

    const second = await c.request<{ thread: { id: string; title: string } }>('thread.create', {
      id,
      projectId: project.id,
    })
    expect(second.thread.id).toBe(id)
    expect(second.thread.title).toBe('Renamed after create')

    const matches = store.listThreads().filter((t) => t.id === id)
    expect(matches).toHaveLength(1)

    c.close()
  })

  test('thread.create rejects same id under a different project', async () => {
    const { port } = boot()
    const c = await connect(port)

    const { project: projectA } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/proj-a',
    })
    const { project: projectB } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/proj-b',
    })
    const id = newId()

    await c.request('thread.create', { id, projectId: projectA.id })

    const reqId = newId()
    const resP = new Promise<ResponseMessage>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage
        if ('ok' in msg && msg.id === reqId) {
          c.ws.removeEventListener('message', onMsg)
          resolve(msg)
        }
      }
      c.ws.addEventListener('message', onMsg)
    })
    c.ws.send(
      JSON.stringify({
        id: reqId,
        method: 'thread.create',
        params: { id, projectId: projectB.id },
      })
    )
    const res = await resP
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid_params')

    c.close()
  })

  test('thread.create without id is invalid_params', async () => {
    const { port } = boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/missing-id',
    })

    const reqId = newId()
    const resP = new Promise<ResponseMessage>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage
        if ('ok' in msg && msg.id === reqId) {
          c.ws.removeEventListener('message', onMsg)
          resolve(msg)
        }
      }
      c.ws.addEventListener('message', onMsg)
    })
    c.ws.send(
      JSON.stringify({
        id: reqId,
        method: 'thread.create',
        params: { projectId: project.id },
      })
    )
    const res = await resP
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid_params')

    c.close()
  })

  test('client-minted thread id works with turn.start', async () => {
    const { port } = boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/client-id',
    })
    const id = newId()

    const { thread } = await c.request<{ thread: { id: string; projectId: string } }>(
      'thread.create',
      { id, projectId: project.id }
    )
    expect(thread.id).toBe(id)
    expect(thread.projectId).toBe(project.id)

    await c.request('thread.subscribe', { threadId: thread.id })

    const { turnId } = await c.request<{ turnId: string }>('turn.start', {
      threadId: thread.id,
      text: 'client-minted',
    })
    expect(turnId).toBeTruthy()

    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    const events = threadEvents(c, thread.id).map((m) => m.event)
    const types = events.map((e) => e.type)
    expect(types).toContain('turn.started')
    expect(types).toContain('turn.completed')

    const userStart = events.find(
      (e) => e.type === 'item.started' && e.item.kind === 'user_message'
    )
    expect(userStart).toMatchObject({
      type: 'item.started',
      item: { kind: 'user_message', text: 'client-minted', turnId },
    })

    c.close()
  })
})

describe('image attachments', () => {
  test('turn.start with attachments writes files and user-item metadata', async () => {
    const { port, home } = boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/attach-write',
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })

    const { turnId } = await c.request<{ turnId: string }>('turn.start', {
      threadId: thread.id,
      text: 'see this',
      attachments: [{ name: 'shot.png', mimeType: 'image/png', dataUrl: TINY_PNG_DATA_URL }],
    })

    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    const events = threadEvents(c, thread.id).map((m) => m.event)
    const userStart = events.find(
      (e) => e.type === 'item.started' && e.item.kind === 'user_message'
    )
    expect(userStart).toBeTruthy()
    if (!userStart || userStart.type !== 'item.started') throw new Error('expected item.started')
    expect(userStart.item).toMatchObject({
      kind: 'user_message',
      text: 'see this',
      turnId,
    })
    if (userStart.item.kind !== 'user_message') throw new Error('expected user_message')
    expect(userStart.item.attachments).toHaveLength(1)
    const att = userStart.item.attachments[0]!
    expect(att.name).toBe('shot.png')
    expect(att.mimeType).toBe('image/png')
    expect(att.sizeBytes).toBe(TINY_PNG_BYTES.byteLength)
    expect(att.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

    const filePath = join(home, 'attachments', `${att.id}.png`)
    expect(existsSync(filePath)).toBe(true)
    expect(Buffer.from(readFileSync(filePath)).equals(TINY_PNG_BYTES)).toBe(true)

    c.close()
  })

  test('oversized image is invalid_params, no file, no turn', async () => {
    const { port, home } = boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/attach-big',
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })

    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1)
    const dataUrl = `data:image/png;base64,${big.toString('base64')}`

    const reqId = newId()
    const resP = new Promise<ResponseMessage>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage
        if ('ok' in msg && msg.id === reqId) {
          c.ws.removeEventListener('message', onMsg)
          resolve(msg)
        }
      }
      c.ws.addEventListener('message', onMsg)
    })
    c.ws.send(
      JSON.stringify({
        id: reqId,
        method: 'turn.start',
        params: {
          threadId: thread.id,
          text: 'too big',
          attachments: [{ name: 'huge.png', mimeType: 'image/png', dataUrl }],
        },
      })
    )
    const res = await resP
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid_params')

    const attachDir = join(home, 'attachments')
    if (existsSync(attachDir)) {
      expect(readdirSync(attachDir)).toEqual([])
    }

    // no turn events should have been appended
    const events = threadEvents(c, thread.id)
    expect(events).toHaveLength(0)

    c.close()
  })

  test('agent receives image blocks on startTurn', async () => {
    const received: TurnInput[] = []
    const fake: Agent = {
      async startTurn(input, emit) {
        received.push(input)
        emit({ type: 'turn.started', turnId: input.turnId })
        const item = {
          id: newId(),
          turnId: input.turnId,
          createdAt: Date.now(),
          kind: 'assistant_message' as const,
          text: 'ok',
        }
        emit({ type: 'item.started', item })
        emit({ type: 'item.completed', itemId: item.id })
        emit({
          type: 'turn.completed',
          turnId: input.turnId,
          usage: { inputTokens: 0, outputTokens: 0 },
          costUsd: 0,
        })
      },
      interrupt() {},
      steer() {
        return false
      },
      respondToApproval() {
        return false
      },
    }

    const { port } = boot({ agent: fake })
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/attach-agent',
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })

    await c.request('turn.start', {
      threadId: thread.id,
      text: 'look',
      attachments: [{ name: 'a.png', mimeType: 'image/png', dataUrl: TINY_PNG_DATA_URL }],
    })

    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    expect(received).toHaveLength(1)
    const images = received[0]!.images as AgentImage[] | undefined
    expect(images).toHaveLength(1)
    expect(images![0]).toEqual({ mimeType: 'image/png', base64data: TINY_PNG_B64 })
    expect(received[0]!.text).toBe('look')

    c.close()
  })

  test('GET /attachments/<id> serves bytes; unknown and traversal 404', async () => {
    const { port, home } = boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: '/tmp/attach-http',
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })

    await c.request('turn.start', {
      threadId: thread.id,
      text: 'img',
      attachments: [{ name: 'dot.png', mimeType: 'image/png', dataUrl: TINY_PNG_DATA_URL }],
    })
    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    const events = threadEvents(c, thread.id).map((m) => m.event)
    const userStart = events.find(
      (e) => e.type === 'item.started' && e.item.kind === 'user_message'
    )
    if (!userStart || userStart.type !== 'item.started' || userStart.item.kind !== 'user_message') {
      throw new Error('expected user_message')
    }
    const id = userStart.item.attachments[0]!.id

    const ok = await fetch(`http://127.0.0.1:${port}/attachments/${id}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Type')).toBe('image/png')
    const body = Buffer.from(await ok.arrayBuffer())
    expect(body.equals(TINY_PNG_BYTES)).toBe(true)

    const missing = await fetch(`http://127.0.0.1:${port}/attachments/${newId()}`)
    expect(missing.status).toBe(404)

    // fetch() normalizes bare `..` segments; use nested / encoded forms that stay under /attachments/
    const nested = await fetch(`http://127.0.0.1:${port}/attachments/foo/bar`)
    expect(nested.status).toBe(404)

    const encoded = await fetch(
      `http://127.0.0.1:${port}/attachments/${encodeURIComponent('../etc/passwd')}`
    )
    expect(encoded.status).toBe(404)

    const dots = await fetch(`http://127.0.0.1:${port}/attachments/not-a-uuid`)
    expect(dots.status).toBe(404)

    // confirm the real file still lives only under home/attachments
    expect(existsSync(join(home, 'attachments', `${id}.png`))).toBe(true)

    c.close()
  })
})

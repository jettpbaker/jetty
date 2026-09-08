import type { PushMessage, ResponseMessage, ServerMessage } from '@jetty/shared/wire'

import { MAX_IMAGE_BYTES, newId } from '@jetty/shared/wire'
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Deferred, Effect } from 'effect'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// Integration suite runs against the echo agent — no network, no tokens.
process.env.JETTY_AGENT = 'echo'

import type { Agent, AgentImage, TurnInput } from './agent'

import { createAttachments } from './attachments'
import { computeThreadDiff, truncateDiff } from './diff'
import { browse, expandHome } from './fs-browse'
import { fuzzyMatch, searchFiles } from './fs-search'
import { startServer } from './main'
import { createSendImagesTool } from './send-images'
import { createSendVideoTool } from './send-video'
import { openTestStore } from './store-fixture'

/** project.create requires an existing directory — ensure one before creating. */
function dir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

/** 1×1 PNG — tiny valid fixture for attachment tests. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const TINY_PNG_BYTES = Buffer.from(TINY_PNG_B64, 'base64')
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`

type Running = Awaited<ReturnType<typeof startServer>>

const servers: Running[] = []
const homes: string[] = []

async function boot(opts: Parameters<typeof startServer>[0] = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jetty-test-'))
  homes.push(home)
  const running = await startServer({ home, port: 0, hostname: '127.0.0.1', ...opts })
  servers.push(running)
  return running
}

function isChromePush(msg: ServerMessage): msg is Extract<PushMessage, { sub: 'chrome' }> {
  return 'sub' in msg && msg.sub === 'chrome'
}

afterEach(async () => {
  while (servers.length) await servers.pop()?.stop()
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
  for (const admission of ['initial', 'steered'] as const) {
    test(`failed ${admission} user completion rolls back both admission events before publication`, async () => {
      const running = await boot()
      const project = await Effect.runPromise(running.store.createProject(running.home))
      const thread = await Effect.runPromise(running.store.createThread(project.id, newId()))
      const client = await connect(running.port)
      await client.request('thread.subscribe', { threadId: thread.id })
      const active =
        admission === 'steered'
          ? await client.request<{ turnId: string }>('turn.start', {
              threadId: thread.id,
              text: 'first',
            })
          : null
      const db = new Database(join(running.home, 'jetty.db'))
      const writes = spyOn(running.store, 'appendEvents')
      try {
        db.run(`CREATE TRIGGER reject_completion BEFORE INSERT ON thread_events
          WHEN json_extract(NEW.payload_json, '$.type') = 'item.completed'
            AND EXISTS (SELECT 1 FROM thread_events
              WHERE thread_id = NEW.thread_id
                AND json_extract(payload_json, '$.item.id') = json_extract(NEW.payload_json, '$.itemId')
                AND json_extract(payload_json, '$.item.text') = 'never accepted')
          BEGIN SELECT RAISE(ABORT, 'injected second admission write failure'); END`)
        await expect(
          client.request('turn.start', { threadId: thread.id, text: 'never accepted' })
        ).rejects.toThrow('internal')
        expect(writes).toHaveBeenCalledTimes(1)
        const attempted = writes.mock.calls[0]![1]
        const started = attempted[0]
        if (started.type !== 'item.started') throw new Error('Missing user admission start')
        const rejectedId = started.item.id
        expect(attempted[1]).toEqual({ type: 'item.completed', itemId: rejectedId })
        const events = await Effect.runPromise(running.store.getEventsAfter(thread.id, 0))
        const snapshot = await Effect.runPromise(running.store.getThreadState(thread.id))
        expect(snapshot.items.some((item) => item.id === rejectedId)).toBe(false)
        expect(
          snapshot.items.filter((item) => item.kind === 'user_message').map((item) => item.text)
        ).toEqual(active ? ['first'] : [])
        for (const sequence of [events, threadEvents(client, thread.id)]) {
          expect(
            sequence.some(
              ({ event }) =>
                (event.type === 'item.started' && event.item.id === rejectedId) ||
                (event.type === 'item.completed' && event.itemId === rejectedId)
            )
          ).toBe(false)
        }
        if (!active) expect(events.map(({ event }) => event.type)).toEqual(['turn.failed'])
        db.run('DROP TRIGGER reject_completion')
        const retry = await client.request<{ turnId: string }>('turn.start', {
          threadId: thread.id,
          text: 'never accepted',
        })
        if (active) expect(retry.turnId).toBe(active.turnId)
        await client.waitFor(
          (message) => isThreadPush(message) && message.event.type === 'turn.completed'
        )
        const completed = await Effect.runPromise(running.store.getThreadState(thread.id))
        expect(
          completed.items.filter((item) => item.kind === 'user_message').map((item) => item.text)
        ).toEqual(active ? ['first', 'never accepted'] : ['never accepted'])
        expect(
          completed.items
            .filter((item) => item.kind === 'assistant_message')
            .map((item) => item.text)
        ).toEqual([active ? 'firstnever accepted' : 'never accepted'])
        const committed = await Effect.runPromise(running.store.getEventsAfter(thread.id, 0))
        expect(threadEvents(client, thread.id).map(({ seq, event }) => ({ seq, event }))).toEqual(
          committed.map(({ seq, event }) => ({ seq, event }))
        )
        expect(committed.map(({ seq }) => seq)).toEqual(committed.map((_, index) => index + 1))
      } finally {
        writes.mockRestore()
        db.close()
        client.close()
      }
    })
  }

  test('SQL persistence failure rejects initial and steered input without handing it to the agent', async () => {
    const running = await boot()
    const project = await Effect.runPromise(running.store.createProject(running.home))
    const thread = await Effect.runPromise(running.store.createThread(project.id, newId()))
    const client = await connect(running.port)
    await client.request('thread.subscribe', { threadId: thread.id })
    const db = new Database(join(running.home, 'jetty.db'))
    try {
      db.run(`CREATE TRIGGER reject_input BEFORE INSERT ON thread_events
        WHEN json_extract(NEW.payload_json, '$.item.text') = 'lost'
        BEGIN SELECT RAISE(ABORT, 'injected input failure'); END`)
      await expect(
        client.request('turn.start', { threadId: thread.id, text: 'lost' })
      ).rejects.toThrow('internal')
      expect(
        (await Effect.runPromise(running.store.getThreadState(thread.id))).activeTurnId
      ).toBeNull()
      const first = await client.request<{ turnId: string }>('turn.start', {
        threadId: thread.id,
        text: 'first',
      })
      await expect(
        client.request('turn.start', { threadId: thread.id, text: 'lost' })
      ).rejects.toThrow('internal')
      const second = await client.request<{ turnId: string }>('turn.start', {
        threadId: thread.id,
        text: 'second',
      })
      expect(second.turnId).toBe(first.turnId)
      await client.waitFor(
        (message) => isThreadPush(message) && message.event.type === 'turn.completed'
      )
      const state = await Effect.runPromise(running.store.getThreadState(thread.id))
      expect(
        state.items.filter((item) => item.kind === 'user_message').map((item) => item.text)
      ).toEqual(['first', 'second'])
      expect(
        state.items.filter((item) => item.kind === 'assistant_message').map((item) => item.text)
      ).toEqual(['firstsecond'])
      const events = await Effect.runPromise(running.store.getEventsAfter(thread.id, 0))
      const secondUser = events.findIndex(
        ({ event }) =>
          event.type === 'item.started' &&
          event.item.kind === 'user_message' &&
          event.item.text === 'second'
      )
      const secondDelta = events.findIndex(
        ({ event }) => event.type === 'item.delta' && event.delta === 'se'
      )
      expect(secondUser).toBeGreaterThan(-1)
      expect(secondDelta).toBeGreaterThan(secondUser)
      expect(
        events.filter(
          ({ event }) =>
            (event.type === 'turn.completed' || event.type === 'turn.failed') &&
            event.turnId === first.turnId
        )
      ).toHaveLength(1)
    } finally {
      db.close()
      client.close()
    }
  })

  test('shutdown interrupts a suspended subscription before closing its database', async () => {
    const running = await boot()
    const project = await Effect.runPromise(running.store.createProject(running.home))
    const thread = await Effect.runPromise(running.store.createThread(project.id, newId()))
    const client = await connect(running.port)
    const entered = Deferred.makeUnsafe<void>()
    let interrupted = false
    const read = spyOn(running.store, 'getThreadState').mockImplementation(() =>
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true
          })
        )
      )
    )
    client.ws.send(
      JSON.stringify({ id: 'pending', method: 'thread.subscribe', params: { threadId: thread.id } })
    )
    await Effect.runPromise(Deferred.await(entered))
    await running.stop()
    expect(interrupted).toBe(true)
    expect(client.messages.some((message) => 'id' in message && message.id === 'pending')).toBe(
      false
    )
    read.mockRestore()
    await expect(Effect.runPromise(running.store.getThreadState(thread.id))).rejects.toMatchObject({
      code: 'internal',
    })
  })

  test('simultaneous starts serialize admission and survive both client disconnects', async () => {
    const running = await boot()
    const project = await Effect.runPromise(running.store.createProject(running.home))
    const thread = await Effect.runPromise(running.store.createThread(project.id, newId()))
    const first = await connect(running.port)
    const second = await connect(running.port)
    const turns = await Promise.all([
      first.request<{ turnId: string }>('turn.start', { threadId: thread.id, text: 'first' }),
      second.request<{ turnId: string }>('turn.start', { threadId: thread.id, text: 'second' }),
    ])
    expect(turns[0]!.turnId).toBe(turns[1]!.turnId)
    first.close()
    second.close()
    const observer = await connect(running.port)
    await observer.request('thread.subscribe', { threadId: thread.id, afterSeq: 0 })
    await observer.waitFor(
      (message) => isThreadPush(message) && message.event.type === 'turn.completed'
    )
    const events = await Effect.runPromise(running.store.getEventsAfter(thread.id, 0))
    expect(events.filter(({ event }) => event.type === 'turn.started')).toHaveLength(1)
    expect(events.filter(({ event }) => event.type === 'turn.completed')).toHaveLength(1)
    expect(
      events.filter(
        ({ event }) => event.type === 'item.started' && event.item.kind === 'user_message'
      )
    ).toHaveLength(2)
    expect(events.map(({ seq }) => seq)).toEqual(events.map((_, index) => index + 1))
    const assistant = (await Effect.runPromise(running.store.getThreadState(thread.id))).items.find(
      (item) => item.kind === 'assistant_message'
    )
    expect(assistant && 'text' in assistant && assistant.text).toBe('firstsecond')
    observer.close()
  })

  test('shutdown joins active turns, writes one terminal before closing SQLite, and is idempotent', async () => {
    const running = await boot()
    const project = await Effect.runPromise(running.store.createProject(running.home))
    const thread = await Effect.runPromise(running.store.createThread(project.id, newId()))
    const client = await connect(running.port)
    await client.request('turn.start', { threadId: thread.id, text: 'in flight' })
    await Promise.all([running.stop(), running.stop()])
    await expect(Effect.runPromise(running.store.getEventsAfter(thread.id, 0))).rejects.toThrow()
    const db = await openTestStore(running.home)
    try {
      const { store } = db
      const terminals = (await Effect.runPromise(store.getEventsAfter(thread.id, 0))).filter(
        ({ event }) => event.type === 'turn.completed' || event.type === 'turn.failed'
      )
      expect(terminals).toHaveLength(1)
      expect(terminals[0]!.event).toMatchObject({ type: 'turn.failed', error: 'server shutdown' })
      expect((await Effect.runPromise(store.getThreadState(thread.id))).activeTurnId).toBeNull()
    } finally {
      await db.close()
    }
  })

  test('a listener startup failure rolls back the already acquired SQLite connection', async () => {
    const running = await boot()
    const home = mkdtempSync(join(tmpdir(), 'jetty-startup-failure-'))
    homes.push(home)
    const close = spyOn(Database.prototype, 'close')
    try {
      await expect(startServer({ home, port: running.port, agent: 'echo' })).rejects.toThrow()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      close.mockRestore()
    }
    const retry = await startServer({ home, port: 0, agent: 'echo' })
    servers.push(retry)
    expect(retry.port).toBeGreaterThan(0)
  })

  test('create project → thread → subscribe → turn.start streams events', async () => {
    const { port } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string; path: string } }>(
      'project.create',
      { path: dir('/tmp/demo') }
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

    const contextEvents = events.filter((e) => e.type === 'context.updated')
    expect(contextEvents.length).toBeGreaterThanOrEqual(1)
    const lastContext = contextEvents.at(-1)!
    expect(lastContext.type).toBe('context.updated')
    if (lastContext.type === 'context.updated') {
      const sliceSum = lastContext.usage.slices.reduce((sum, s) => sum + s.tokens, 0)
      expect(sliceSum).toBe(lastContext.usage.usedTokens)
      expect(lastContext.usage.maxTokens).toBe(200_000)
    }

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
        context: {
          usedTokens: number
          maxTokens: number
          slices: Array<{ label: string; tokens: number }>
        } | null
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
    expect(again.snapshot.context).not.toBeNull()
    expect(again.snapshot.context!.slices.reduce((s, x) => s + x.tokens, 0)).toBe(
      again.snapshot.context!.usedTokens
    )

    c.close()
    c2.close()
  })

  test('reconnect with afterSeq replays the gap', async () => {
    const { port } = await boot()
    const c1 = await connect(port)

    const { project } = await c1.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/gap'),
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
    const { port } = await boot()
    const a = await connect(port)
    const b = await connect(port)

    const { project } = await a.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/fan'),
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
    const { port } = await boot()
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
    await c.request('project.create', { path: dir('/tmp/still-alive') })

    c.close()
  })

  test('steer: second turn.start mid-turn joins active turn', async () => {
    const { port } = await boot()
    const c = await connect(port)
    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/busy'),
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
    const { port, store } = await boot({
      agent: 'echo',
      titler: (text) =>
        Effect.sync(() => {
          titlerCalls.push(text)
          return 'Fix the login bug'
        }),
    })
    const c = await connect(port)
    await c.request('chrome.subscribe', {})

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/title-gen'),
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
    expect((await Effect.runPromise(store.getThread(thread.id)))?.title).toBe('Fix the login bug')

    c.close()
  })

  test('thread that already has a title never triggers titler', async () => {
    let called = false
    const { port, store } = await boot({
      agent: 'echo',
      titler: () =>
        Effect.sync(() => {
          called = true
          return 'Should not apply'
        }),
    })
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/title-skip'),
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await Effect.runPromise(store.setThreadTitle(thread.id, 'Existing title'))

    await c.request('thread.subscribe', { threadId: thread.id })
    await c.request('turn.start', { threadId: thread.id, text: 'hello' })
    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )
    // titler is sync-resolving but fire-and-forget; give it a tick
    await Bun.sleep(20)

    expect(called).toBe(false)
    expect((await Effect.runPromise(store.getThread(thread.id)))?.title).toBe('Existing title')

    c.close()
  })

  test('titler returning null leaves title unchanged', async () => {
    let called = false
    const { port, store } = await boot({
      agent: 'echo',
      titler: () =>
        Effect.sync(() => {
          called = true
          return null
        }),
    })
    const c = await connect(port)
    await c.request('chrome.subscribe', {})

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/title-null'),
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
    expect((await Effect.runPromise(store.getThread(thread.id)))?.title).toBe('New thread')

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

    const db = await openTestStore(home)
    const { store } = db
    const project = await Effect.runPromise(store.createProject(dir('/tmp/reconcile')))
    const thread = await Effect.runPromise(store.createThread(project.id, newId()))
    await Effect.runPromise(
      store.appendEvent(thread.id, { type: 'turn.started', turnId: 'orphan-turn' })
    )
    expect((await Effect.runPromise(store.getThreadState(thread.id))).status).toBe('running')
    await db.close()

    const running = await startServer({ home, port: 0, hostname: '127.0.0.1', agent: 'echo' })
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
    const { port, store } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/idempotent'),
    })
    const id = newId()

    const first = await c.request<{ thread: { id: string; title: string } }>('thread.create', {
      id,
      projectId: project.id,
    })
    expect(first.thread.id).toBe(id)
    expect(first.thread.title).toBe('New thread')
    await Effect.runPromise(store.setThreadTitle(id, 'Renamed after create'))

    const second = await c.request<{ thread: { id: string; title: string } }>('thread.create', {
      id,
      projectId: project.id,
    })
    expect(second.thread.id).toBe(id)
    expect(second.thread.title).toBe('Renamed after create')

    const matches = (await Effect.runPromise(store.listThreads())).filter((t) => t.id === id)
    expect(matches).toHaveLength(1)

    c.close()
  })

  test('thread.create rejects same id under a different project', async () => {
    const { port } = await boot()
    const c = await connect(port)

    const { project: projectA } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/proj-a'),
    })
    const { project: projectB } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/proj-b'),
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
    const { port } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/missing-id'),
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
    expect(res.error?.message).toMatch(/Missing key/)
    expect(res.error?.message).toContain('["id"]')

    c.close()
  })

  test('client-minted thread id works with turn.start', async () => {
    const { port } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/client-id'),
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
    const { port, home } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/attach-write'),
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
    const { port, home } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/attach-big'),
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

  test('base64 that passes the charset but decodes to nothing is invalid_params', async () => {
    const { port, home } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/attach-junk'),
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })

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
          text: 'junk',
          // a lone base64 char: legal charset, decodes to zero bytes
          attachments: [
            { name: 'junk.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,a' },
          ],
        },
      })
    )
    const res = await resP
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid_params')
    expect(res.error?.message).toContain('empty')

    const attachDir = join(home, 'attachments')
    if (existsSync(attachDir)) {
      expect(readdirSync(attachDir)).toEqual([])
    }
    expect(threadEvents(c, thread.id)).toHaveLength(0)

    c.close()
  })

  test('agent receives image blocks on startTurn', async () => {
    const received: TurnInput[] = []
    const fake: Agent = {
      startTurn(input, emit) {
        return Effect.gen(function* () {
          received.push(input)
          yield* emit({ type: 'turn.started', turnId: input.turnId })
          const item = {
            id: newId(),
            turnId: input.turnId,
            createdAt: Date.now(),
            kind: 'assistant_message' as const,
            text: 'ok',
          }
          yield* emit({ type: 'item.started', item })
          yield* emit({ type: 'item.completed', itemId: item.id })
          yield* emit({
            type: 'turn.completed',
            turnId: input.turnId,
            usage: { inputTokens: 0, outputTokens: 0 },
            costUsd: 0,
          })
          return { await: Effect.void }
        })
      },
      interrupt() {
        return Effect.void
      },
      steer() {
        return Effect.succeed(false)
      },
      respondToApproval() {
        return Effect.succeed(false)
      },
      respondToQuestion() {
        return Effect.succeed(false)
      },
    }

    const { port } = await boot({ agent: fake })
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/attach-agent'),
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
    const { port, home } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir('/tmp/attach-http'),
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

  test('image_gallery item is stored and served', async () => {
    const projectDir = dir('/tmp/gallery-agent')
    writeFileSync(join(projectDir, 'shot.png'), TINY_PNG_BYTES)

    let jettyHome = ''
    const fake: Agent = {
      startTurn(input, emit) {
        return Effect.gen(function* () {
          yield* emit({ type: 'turn.started', turnId: input.turnId })
          const run = Effect.runPromiseWith(yield* Effect.context<never>())
          yield* Effect.promise(() =>
            createSendImagesTool({
              attachments: createAttachments(jettyHome),
              projectPath: projectDir,
              turnId: () => input.turnId,
              emit: (event) => run(emit(event)),
            }).handler({ paths: ['shot.png'], caption: 'UI check' }, {})
          )
          yield* emit({
            type: 'turn.completed',
            turnId: input.turnId,
            usage: { inputTokens: 0, outputTokens: 0 },
            costUsd: 0,
          })
          return { await: Effect.void }
        })
      },
      interrupt() {
        return Effect.void
      },
      steer() {
        return Effect.succeed(false)
      },
      respondToApproval() {
        return Effect.succeed(false)
      },
      respondToQuestion() {
        return Effect.succeed(false)
      },
    }

    const { port, home } = await boot({ agent: fake })
    jettyHome = home
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: projectDir,
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })

    await c.request('turn.start', { threadId: thread.id, text: 'show shots' })
    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    const events = threadEvents(c, thread.id).map((m) => m.event)
    const started = events.find((e) => e.type === 'item.started' && e.item.kind === 'image_gallery')
    if (!started || started.type !== 'item.started' || started.item.kind !== 'image_gallery') {
      throw new Error('expected image_gallery')
    }
    expect(started.item.caption).toBe('UI check')
    expect(started.item.images).toHaveLength(1)
    expect(started.item.images[0]!.name).toBe('shot.png')
    expect(started.item.images[0]!.mimeType).toBe('image/png')
    const attachId = started.item.images[0]!.id

    const cold = await connect(port)
    const sub = await cold.request<{
      snapshot: {
        items: Array<{ kind: string; caption?: string; images?: Array<{ id: string }> }>
      }
    }>('thread.subscribe', { threadId: thread.id })
    const gallery = sub.snapshot.items.find((i) => i.kind === 'image_gallery')
    expect(gallery).toMatchObject({ kind: 'image_gallery', caption: 'UI check' })
    expect(gallery?.images?.[0]?.id).toBe(attachId)

    const ok = await fetch(`http://127.0.0.1:${port}/attachments/${attachId}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await ok.arrayBuffer()).equals(TINY_PNG_BYTES)).toBe(true)

    cold.close()
    c.close()
  })

  test('video item is stored and served with Range support', async () => {
    const projectDir = dir('/tmp/video-agent')
    const clip = Buffer.alloc(64, 0xab)
    writeFileSync(join(projectDir, 'clip.mp4'), clip)

    let jettyHome = ''
    const fake: Agent = {
      startTurn(input, emit) {
        return Effect.gen(function* () {
          yield* emit({ type: 'turn.started', turnId: input.turnId })
          const run = Effect.runPromiseWith(yield* Effect.context<never>())
          yield* Effect.promise(() =>
            createSendVideoTool({
              attachments: createAttachments(jettyHome),
              projectPath: projectDir,
              turnId: () => input.turnId,
              emit: (event) => run(emit(event)),
            }).handler({ path: 'clip.mp4', caption: 'UI flow' }, {})
          )
          yield* emit({
            type: 'turn.completed',
            turnId: input.turnId,
            usage: { inputTokens: 0, outputTokens: 0 },
            costUsd: 0,
          })
          return { await: Effect.void }
        })
      },
      interrupt() {
        return Effect.void
      },
      steer() {
        return Effect.succeed(false)
      },
      respondToApproval() {
        return Effect.succeed(false)
      },
      respondToQuestion() {
        return Effect.succeed(false)
      },
    }

    const { port, home } = await boot({ agent: fake })
    jettyHome = home
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: projectDir,
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })
    await c.request('thread.subscribe', { threadId: thread.id })

    await c.request('turn.start', { threadId: thread.id, text: 'show clip' })
    await c.waitFor(
      (m) => isThreadPush(m) && m.event.type === 'turn.completed' && m.threadId === thread.id
    )

    const events = threadEvents(c, thread.id).map((m) => m.event)
    const started = events.find((e) => e.type === 'item.started' && e.item.kind === 'video')
    if (!started || started.type !== 'item.started' || started.item.kind !== 'video') {
      throw new Error('expected video')
    }
    expect(started.item.caption).toBe('UI flow')
    expect(started.item.video.name).toBe('clip.mp4')
    expect(started.item.video.mimeType).toBe('video/mp4')
    const attachId = started.item.video.id

    const cold = await connect(port)
    const sub = await cold.request<{
      snapshot: {
        items: Array<{ kind: string; caption?: string; video?: { id: string } }>
      }
    }>('thread.subscribe', { threadId: thread.id })
    const video = sub.snapshot.items.find((i) => i.kind === 'video')
    expect(video).toMatchObject({ kind: 'video', caption: 'UI flow' })
    expect(video?.video?.id).toBe(attachId)

    const ok = await fetch(`http://127.0.0.1:${port}/attachments/${attachId}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Type')).toBe('video/mp4')
    expect(ok.headers.get('Accept-Ranges')).toBe('bytes')
    expect(Buffer.from(await ok.arrayBuffer()).equals(clip)).toBe(true)

    const partial = await fetch(`http://127.0.0.1:${port}/attachments/${attachId}`, {
      headers: { Range: 'bytes=10-19' },
    })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('Content-Range')).toBe(`bytes 10-19/${clip.byteLength}`)
    expect(Buffer.from(await partial.arrayBuffer()).equals(clip.subarray(10, 20))).toBe(true)

    const unsat = await fetch(`http://127.0.0.1:${port}/attachments/${attachId}`, {
      headers: { Range: 'bytes=9999-' },
    })
    expect(unsat.status).toBe(416)

    cold.close()
    c.close()
  })
})

describe('fs.browse', () => {
  let fixture: string

  function names(partialPath: string): string[] {
    return browse(partialPath).entries.map((entry) => entry.name)
  }

  function makeFixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'jetty-browse-'))
    for (const name of ['apple', 'apricot', 'Banana', '.hidden']) {
      mkdirSync(join(root, name))
    }
    writeFileSync(join(root, 'notdir.txt'), 'x')
    return root
  }

  afterEach(async () => {
    if (fixture) rmSync(fixture, { recursive: true, force: true })
  })

  test('expands a leading ~ to the home directory', () => {
    expect(expandHome('~')).toBe(homedir())
    expect(expandHome('~/code/app')).toBe(join(homedir(), 'code/app'))
    expect(expandHome('/absolute/path')).toBe('/absolute/path')
  })

  test('lists directories only, hides dotfiles', () => {
    fixture = makeFixture()
    const listed = names(`${fixture}/`)
    expect(listed).toContain('apple')
    expect(listed).toContain('apricot')
    expect(listed).toContain('Banana')
    expect(listed).not.toContain('.hidden')
    expect(listed).not.toContain('notdir.txt')
  })

  test('filters by case-insensitive prefix', () => {
    fixture = makeFixture()
    expect(names(`${fixture}/ap`).sort()).toEqual(['apple', 'apricot'])
    expect(names(`${fixture}/AP`).sort()).toEqual(['apple', 'apricot'])
    expect(names(`${fixture}/ban`)).toEqual(['Banana'])
  })

  test('reveals dotfiles when the filter segment is dotted', () => {
    fixture = makeFixture()
    expect(names(`${fixture}/.h`)).toEqual(['.hidden'])
  })

  test('returns empty entries for a nonexistent parent', () => {
    expect(browse('/no/such/directory/anywhere/').entries).toEqual([])
  })
})

describe('fs.search', () => {
  test('fuzzyMatch: case-insensitive subsequence', () => {
    expect(fuzzyMatch('src/components/Button.tsx', 'btn')).not.toBeNull()
    expect(fuzzyMatch('src/components/Button.tsx', 'BTN')).not.toBeNull()
    expect(fuzzyMatch('src/components/Button.tsx', 'sbt')).not.toBeNull()
    expect(fuzzyMatch('src/components/Button.tsx', 'sctx')).not.toBeNull()
  })

  test('fuzzyMatch: prefers basename hits over directory hits', () => {
    const base = fuzzyMatch('app/src/utils/string.ts', 'string')!
    const dir = fuzzyMatch('string/parser.ts', 'string')!
    expect(base).toBeGreaterThan(dir)
  })

  test('fuzzyMatch: no match returns null', () => {
    expect(fuzzyMatch('src/app.ts', 'xyz')).toBeNull()
    expect(fuzzyMatch('src/app.ts', 'appz')).toBeNull()
    expect(fuzzyMatch('src/app.ts', '')).toBeNull()
  })

  test('fuzzyMatch: contiguous runs score higher than scattered', () => {
    // "app" is contiguous in both, but "ap" contiguous in app.ts vs scattered would be lower
    const contiguous = fuzzyMatch('src/app.ts', 'app')!
    const scattered = fuzzyMatch('a/x/p/p.ts', 'app')!
    expect(contiguous).toBeGreaterThan(scattered)
  })

  function initGitRepo(files: Record<string, string>): string | null {
    const repo = dir(join(tmpdir(), `jetty-search-repo-${newId()}`))
    const run = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: repo }).exitCode
    if (run(['init', '-q']) !== 0) return null
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'Test'])
    run(['config', 'commit.gpgsign', 'false'])
    for (const [rel, content] of Object.entries(files)) {
      const full = join(repo, rel)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, content)
    }
    run(['add', '.'])
    run(['commit', '-qm', 'init'])
    return repo
  }

  test('searchFiles ranks expected paths from a git repo', async () => {
    const repo = initGitRepo({
      'src/components/Button.tsx': 'x',
      'src/utils/string.ts': 'x',
      'string/parser.ts': 'x',
      'lib/helpers.ts': 'x',
      'README.md': 'x',
    })
    if (!repo) return // git unavailable

    const byString = await searchFiles(repo, 'string')
    expect(byString[0]).toBe('src/utils/string.ts')
    expect(byString).toContain('string/parser.ts')
    expect(byString).not.toContain('README.md')

    const byBtn = await searchFiles(repo, 'btn')
    expect(byBtn).toEqual(['src/components/Button.tsx'])

    const byHelp = await searchFiles(repo, 'help')
    expect(byHelp).toEqual(['lib/helpers.ts'])
  })

  test('empty query returns []', async () => {
    const repo = initGitRepo({ 'a.ts': 'x' })
    if (!repo) return
    expect(await searchFiles(repo, '')).toEqual([])
  })

  test('non-git project dir returns [] over the wire', async () => {
    const { port } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir(join(tmpdir(), `jetty-search-nongit-${newId()}`)),
    })

    const res = await c.request<{ files: string[] }>('fs.search', {
      projectId: project.id,
      query: 'anything',
    })
    expect(res.files).toEqual([])

    c.close()
  })

  test('end-to-end: ranked results over the wire', async () => {
    const repo = initGitRepo({
      'src/components/Button.tsx': 'x',
      'src/utils/string.ts': 'x',
      'string/parser.ts': 'x',
      'lib/helpers.ts': 'x',
    })
    if (!repo) return

    const { port } = await boot()
    const c = await connect(port)
    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: repo,
    })

    const res = await c.request<{ files: string[] }>('fs.search', {
      projectId: project.id,
      query: 'string',
    })
    expect(res.files[0]).toBe('src/utils/string.ts')
    expect(res.files).toContain('string/parser.ts')

    const empty = await c.request<{ files: string[] }>('fs.search', {
      projectId: project.id,
      query: '',
    })
    expect(empty.files).toEqual([])

    c.close()
  })

  test('unknown projectId → not_found', async () => {
    const { port } = await boot()
    const c = await connect(port)

    await expect(
      c.request('fs.search', { projectId: 'no-such-project', query: 'x' })
    ).rejects.toThrow('not_found')

    c.close()
  })
})

describe('skills.list', () => {
  function writeProjectSkill(projectPath: string, name: string, description: string) {
    const dir = join(projectPath, '.claude', 'skills', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\ndescription: ${description}\n---\n`)
  }

  test('returns project skills over the wire', async () => {
    const repo = dir(join(tmpdir(), `jetty-skills-wire-${newId()}`))
    writeProjectSkill(repo, 'review', 'Look at the diff')
    writeProjectSkill(repo, 'hidden', 'nope')
    writeFileSync(
      join(repo, '.claude', 'skills', 'hidden', 'SKILL.md'),
      '---\ndescription: nope\nuser-invocable: false\n---\n'
    )

    const { port } = await boot()
    const c = await connect(port)
    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: repo,
    })

    const res = await c.request<{ skills: Array<{ name: string; description: string }> }>(
      'skills.list',
      { projectId: project.id }
    )
    expect(
      res.skills.some((s) => s.name === 'review' && s.description === 'Look at the diff')
    ).toBe(true)
    expect(res.skills.some((s) => s.name === 'hidden')).toBe(false)

    c.close()
  })

  test('unknown projectId → not_found', async () => {
    const { port } = await boot()
    const c = await connect(port)
    await expect(c.request('skills.list', { projectId: 'no-such-project' })).rejects.toThrow(
      'not_found'
    )
    c.close()
  })
})

describe('thread.diff', () => {
  test('non-git project directory responds with an empty diff', async () => {
    const { port } = await boot()
    const c = await connect(port)

    const { project } = await c.request<{ project: { id: string } }>('project.create', {
      path: dir(join(tmpdir(), `jetty-diff-nongit-${newId()}`)),
    })
    const { thread } = await c.request<{ thread: { id: string } }>('thread.create', {
      id: newId(),
      projectId: project.id,
    })

    const res = await c.request<{ diff: string; truncatedPaths?: string[] }>('thread.diff', {
      threadId: thread.id,
    })
    expect(res.diff).toBe('')
    expect(res.truncatedPaths).toBeUndefined()

    c.close()
  })

  test('computeThreadDiff surfaces uncommitted changes as a unified patch', async () => {
    const repo = dir(join(tmpdir(), `jetty-diff-repo-${newId()}`))
    const run = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: repo }).exitCode
    if (run(['init', '-q']) !== 0) return // git unavailable in this sandbox
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'Test'])
    run(['config', 'commit.gpgsign', 'false']) // don't block on a signing agent
    writeFileSync(join(repo, 'hello.txt'), 'one\ntwo\n')
    run(['add', '.'])
    run(['commit', '-qm', 'init'])
    writeFileSync(join(repo, 'hello.txt'), 'one\nthree\n')

    const home = mkdtempSync(join(tmpdir(), 'jetty-diff-'))
    homes.push(home)
    const db = await openTestStore(home)
    const { store } = db
    const project = await Effect.runPromise(store.createProject(repo))
    const thread = await Effect.runPromise(store.createThread(project.id, newId()))

    const res = await computeThreadDiff(
      (await Effect.runPromise(store.getProject(thread.projectId)))!.path
    )
    expect(res.diff).toContain('diff --git a/hello.txt b/hello.txt')
    expect(res.diff).toContain('+three')
    expect(res.diff).toContain('-two')

    await db.close()
  })

  test('computeThreadDiff includes untracked files and survives an unborn HEAD', async () => {
    const repo = dir(join(tmpdir(), `jetty-diff-fresh-${newId()}`))
    const run = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: repo }).exitCode
    if (run(['init', '-q']) !== 0) return // git unavailable in this sandbox
    // no commit at all — HEAD is unborn, every file untracked
    writeFileSync(join(repo, 'main.ts'), 'console.log("hi")\n')
    writeFileSync(join(repo, 'bun.lock'), 'lock\n')

    const home = mkdtempSync(join(tmpdir(), 'jetty-diff-'))
    homes.push(home)
    const db = await openTestStore(home)
    const { store } = db
    const project = await Effect.runPromise(store.createProject(repo))
    const thread = await Effect.runPromise(store.createThread(project.id, newId()))

    const res = await computeThreadDiff(
      (await Effect.runPromise(store.getProject(thread.projectId)))!.path
    )
    expect(res.diff).toContain('diff --git a/main.ts b/main.ts')
    expect(res.diff).toContain('new file mode')
    expect(res.diff).toContain('+console.log("hi")')
    expect(res.truncatedPaths).toEqual(['bun.lock'])

    await db.close()
  })

  test('truncateDiff strips lockfiles and pathological files, keeps normal ones', () => {
    const normal = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 111..222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-const a = 1',
      '+const a = 2',
      '',
    ].join('\n')
    const lock = [
      'diff --git a/bun.lock b/bun.lock',
      'index 333..444 100644',
      '--- a/bun.lock',
      '+++ b/bun.lock',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n')

    const result = truncateDiff(normal + lock)
    expect(result.diff).toContain('src/app.ts')
    expect(result.diff).not.toContain('bun.lock\nindex') // body dropped
    expect(result.truncatedPaths).toEqual(['bun.lock'])

    expect(truncateDiff('').diff).toBe('')
    expect(truncateDiff('   ').truncatedPaths).toBeUndefined()
  })
})

describe('ws origin gate', () => {
  test('browser origins must be loopback; native clients pass', async () => {
    const { port } = await boot()
    const upgrade = (origin?: string) =>
      fetch(`http://127.0.0.1:${port}/ws`, {
        headers: {
          ...(origin ? { Origin: origin } : {}),
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      })

    expect((await upgrade('https://evil.example')).status).toBe(403)
    expect((await upgrade('http://localhost:5173')).status).not.toBe(403)
    expect((await upgrade('http://127.0.0.1:8787')).status).not.toBe(403)
    expect((await upgrade()).status).not.toBe(403)
  })
})

describe('project.create validation', () => {
  test('rejects a path that is not an existing directory', async () => {
    const { port } = await boot()
    const c = await connect(port)

    const missing = join(tmpdir(), `jetty-missing-${newId()}`)
    await expect(c.request('project.create', { path: missing })).rejects.toThrow('invalid_params')

    c.close()
  })

  test('is idempotent for a duplicate directory', async () => {
    const { port, store } = await boot()
    const c = await connect(port)

    const path = dir(join(tmpdir(), `jetty-dup-${newId()}`))
    const first = await c.request<{ project: { id: string } }>('project.create', { path })
    const second = await c.request<{ project: { id: string } }>('project.create', { path })

    expect(second.project.id).toBe(first.project.id)
    expect(
      (await Effect.runPromise(store.listProjects())).filter((p) => p.path === path)
    ).toHaveLength(1)

    c.close()
  })
})

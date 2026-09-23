import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadUpdate } from '@jetty/shared/rpc'

import { newId } from '@jetty/shared/wire'
import { afterEach, expect, spyOn, test } from 'bun:test'
import { Deferred, Effect, Fiber, Schedule, Stream } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Agent, Emit } from './agent'

import { startServer } from './main'
import { connect, type Client } from './rpc-test-client'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'jetty-rpc-'))
  let emit: Emit = () => Effect.die('Turn not started')
  const agent: Agent = {
    startTurn(_input, publish) {
      emit = publish
      return Effect.succeed({ await: Effect.never })
    },
    steer: () => Effect.succeed(false),
    interrupt: () => Effect.void,
    respondToApproval: () => Effect.succeed(false),
    respondToQuestion: () => Effect.succeed(false),
  }
  const server = await startServer({ home, port: 0, agent })
  cleanup.push(async () => {
    await server.stop()
    rmSync(home, { recursive: true, force: true })
  })
  async function client() {
    const connection = await connect(server.port)
    cleanup.push(connection.close)
    return connection
  }
  const connection = await client()
  const { project } = await connection.request('project.create', { path: home })
  const { thread } = await connection.request('thread.create', {
    projectId: project.id,
    id: newId(),
  })
  const { turnId } = await connection.request('turn.start', { threadId: thread.id, text: 'hello' })
  return {
    server,
    connection,
    client,
    thread,
    turnId,
    publish: (event: ThreadEvent) => Effect.runPromise(emit(event)),
  }
}

async function subscribers(server: Awaited<ReturnType<typeof startServer>>, count: number) {
  await Effect.runPromise(
    server.hub.subscriberCount.pipe(
      Effect.repeat({ until: (value) => value === count, schedule: Schedule.spaced(1) }),
      Effect.timeout('2 seconds')
    )
  )
}

for (const replay of [false, true]) {
  for (const first of ['read', 'append'] as const) {
    test(`native ${replay ? 'replay' : 'snapshot'} stream orders live commits while ${first} is suspended`, async () => {
      const f = await fixture()
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const baseRead = f.server.store.getThreadState
      const baseAppend = f.server.store.appendEvent
      let readStarted = false
      const read = spyOn(f.server.store, 'getThreadState').mockImplementation((id) =>
        Effect.gen(function* () {
          readStarted = true
          const state = yield* baseRead(id)
          if (first === 'read') {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }
          return state
        })
      )
      const append = spyOn(f.server.store, 'appendEvent').mockImplementation((id, event) =>
        Effect.gen(function* () {
          if (first === 'append' && event.type === 'turn.started') {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }
          return yield* baseAppend(id, event)
        })
      )
      try {
        let subscription: ReturnType<Client['subscribeThread']>
        let publication: Promise<void>
        if (first === 'read') {
          subscription = f.connection.subscribeThread({
            threadId: f.thread.id,
            ...(replay ? { afterSeq: 0 } : {}),
          })
          await Effect.runPromise(Deferred.await(entered))
          publication = f.publish({ type: 'turn.started', turnId: f.turnId })
          expect((await Effect.runPromise(baseRead(f.thread.id))).lastSeq).toBe(2)
        } else {
          publication = f.publish({ type: 'turn.started', turnId: f.turnId })
          await Effect.runPromise(Deferred.await(entered))
          subscription = f.connection.subscribeThread({
            threadId: f.thread.id,
            ...(replay ? { afterSeq: 0 } : {}),
          })
          await f.connection.request('thread.diff', { threadId: f.thread.id })
          expect(readStarted).toBe(false)
        }
        expect(subscription.messages).toEqual([])
        await Effect.runPromise(Deferred.succeed(release, undefined))
        await publication
        const initial = await subscription.ready
        expect(initial.seq).toBe(first === 'read' ? 2 : 3)
        await f.publish({ type: 'session.status', status: 'awaiting_approval' })
        await subscription.waitFor((update) => update.type === 'event' && update.seq === 4)
        expect(
          subscription.messages
            .filter((update) => update.type === 'event')
            .map((update) => update.seq)
        ).toEqual(replay ? [1, 2, 3, 4] : first === 'read' ? [3, 4] : [4])
        expect(subscription.messages.every((update) => !('threadId' in update))).toBe(true)
        if (replay) {
          expect(subscription.messages.findIndex((update) => update.type === 'ready')).toBe(
            initial.seq
          )
        } else {
          expect(subscription.messages[0]).toMatchObject({
            type: 'snapshot',
            snapshot: { lastSeq: initial.seq },
          })
        }
        await subscription.cancel()
        await subscribers(f.server, 0)
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined))
        read.mockRestore()
        append.mockRestore()
      }
    })
  }
}

test('native empty replay produces ready, cancellation removes subscriptions, and reconnect replays freshly', async () => {
  const f = await fixture()
  const chrome = f.connection.subscribeChrome()
  expect((await chrome.ready).threads.map((thread) => thread.id)).toContain(f.thread.id)
  const empty = f.connection.subscribeThread({ threadId: f.thread.id, afterSeq: 2 })
  expect(await empty.ready).toEqual({ type: 'ready', seq: 2 })
  expect(empty.messages).toEqual([{ type: 'ready', seq: 2 }])
  await subscribers(f.server, 2)
  await empty.cancel()
  await chrome.cancel()
  await subscribers(f.server, 0)
  await f.connection.close()
  await f.publish({ type: 'turn.started', turnId: f.turnId })
  const reconnect = await f.client()
  const replay = reconnect.subscribeThread({ threadId: f.thread.id, afterSeq: 2 })
  expect(await replay.ready).toEqual({ type: 'ready', seq: 3 })
  expect(replay.messages).toMatchObject([
    { type: 'event', seq: 3, event: { type: 'turn.started', turnId: f.turnId } },
    { type: 'ready', seq: 3 },
  ])
})

test('native unary and stream failures retain WireError code and message', async () => {
  const f = await fixture()
  const missing = newId()
  await expect(
    f.connection.request('turn.start', { threadId: missing, text: 'no' })
  ).rejects.toMatchObject({
    code: 'not_found',
    message: `Thread ${missing} not found`,
  })
  const stream = f.connection.subscribeThread({ threadId: missing })
  await expect(stream.ready).rejects.toMatchObject({
    code: 'not_found',
    message: `Thread ${missing} not found`,
  })
  await subscribers(f.server, 0)
})

test('a stalled native subscriber does not block durable writes or another client and loses no events', async () => {
  const f = await fixture()
  const slow = await f.client()
  const entered = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  const updates: ThreadUpdate[] = []
  const fiber = Effect.runFork(
    slow.rpc('thread.subscribe', { threadId: f.thread.id }).pipe(
      Stream.runForEach((update) =>
        Effect.gen(function* () {
          updates.push(update)
          if (update.type === 'snapshot') {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }
        })
      )
    )
  )
  try {
    await Effect.runPromise(Deferred.await(entered))
    const fast = f.connection.subscribeThread({ threadId: f.thread.id })
    await fast.ready
    for (let index = 0; index < 80; index++) {
      await f.publish({ type: 'session.status', status: 'awaiting_approval' })
    }
    await fast.waitFor((update) => update.type === 'event' && update.seq === 82)
    expect((await Effect.runPromise(f.server.store.getThreadState(f.thread.id))).lastSeq).toBe(82)
    expect(updates).toHaveLength(1)
    await Effect.runPromise(Deferred.succeed(release, undefined))
    await Effect.runPromise(
      Effect.sync(() => updates.at(-1)?.seq).pipe(
        Effect.repeat({ until: (seq) => seq === 82, schedule: Schedule.spaced(1) }),
        Effect.timeout('2 seconds')
      )
    )
    expect(updates.filter((update) => update.type === 'event').map((update) => update.seq)).toEqual(
      Array.from({ length: 80 }, (_, index) => index + 3)
    )
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined))
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
})

test('shutdown with active native streams is awaitable, idempotent, and persists terminal state', async () => {
  const f = await fixture()
  await f.publish({ type: 'turn.started', turnId: f.turnId })
  await f.connection.subscribeChrome().ready
  await f.connection.subscribeThread({ threadId: f.thread.id }).ready
  const started = Date.now()
  const stop = f.server.stop()
  expect(f.server.stop()).toBe(stop)
  await stop
  expect(Date.now() - started).toBeLessThan(2000)
  expect(await Effect.runPromise(f.server.hub.subscriberCount)).toBe(0)
  const restarted = await startServer({ home: f.server.home, port: 0, agent: 'echo' })
  try {
    const state = await Effect.runPromise(restarted.store.getThreadState(f.thread.id))
    expect(state.status).toBe('error')
    expect(
      (await Effect.runPromise(restarted.store.getEventsAfter(f.thread.id, 0))).at(-1)?.event
    ).toMatchObject({
      type: 'turn.failed',
      turnId: f.turnId,
      error: 'server shutdown',
    })
  } finally {
    await restarted.stop()
  }
})

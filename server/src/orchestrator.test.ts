import { BunServices } from '@effect/platform-bun'
import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { SqlClient } from 'effect/unstable/sql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentError, type Agent, type Emit, createEchoAdapter } from './agent'
import { createAttachments } from './attachments'
import { databaseLayer } from './db'
import { createHub } from './hub'
import { createOrchestrator } from './orchestrator'
import { createSendImagesTool } from './send-images'
import { createSendVideoTool } from './send-video'
import { Store, storeLayer, StoreError } from './store'

const upload = {
  name: 'image.png',
  mimeType: 'image/png' as const,
  dataUrl: 'data:image/png;base64,aW1hZ2U=',
}

function runUploadTest<A, E>(effect: Effect.Effect<A, E, BunServices.BunServices | Scope.Scope>) {
  return Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(BunServices.layer)))
}

function makeUploadFixture() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const home = yield* fs.makeTempDirectoryScoped()
    const context = yield* Layer.build(storeLayer.pipe(Layer.provideMerge(databaseLayer(home))))
    const store = Context.get(context, Store)
    const sql = Context.get(context, SqlClient.SqlClient)
    const project = yield* store.createProject(home)
    const thread = yield* store.createThread(project.id, newId())
    const attachments = yield* createAttachments(home)
    const hub = createHub()
    const agent: Agent = {
      startTurn: (input, emit) =>
        emit({ type: 'turn.started', turnId: input.turnId }).pipe(
          Effect.as({ await: Effect.never })
        ),
      steer: (_threadId, _text, _images, beforeAccept = Effect.void) =>
        beforeAccept.pipe(Effect.as(true)),
      interrupt: () => Effect.void,
      respondToApproval: () => Effect.succeed(false),
      respondToQuestion: () => Effect.succeed(false),
    }
    return { fs, home, store, sql, thread, attachments, hub, agent }
  })
}

for (const kind of ['image', 'video'] as const) {
  for (const failure of ['abort', 'publication'] as const) {
    test(`${kind} media keeps its attachment when ${failure} interrupts a durable orchestrator append`, async () => {
      await runUploadTest(
        Effect.gen(function* () {
          const f = yield* makeUploadFixture()
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const itemKind = kind === 'image' ? 'image_gallery' : 'video'
          const store: Store = {
            ...f.store,
            appendEvent(threadId, event) {
              return Effect.gen(function* () {
                if (
                  failure === 'abort' &&
                  event.type === 'item.started' &&
                  event.item.kind === itemKind
                ) {
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                }
                return yield* f.store.appendEvent(threadId, event)
              })
            },
          }
          const pushThread = f.hub.pushThread
          f.hub.pushThread = (threadId, push) => {
            if (
              failure === 'publication' &&
              push.event.type === 'item.started' &&
              push.event.item.kind === itemKind
            )
              throw new Error('hub publication failed after commit')
            pushThread(threadId, push)
          }
          let emit: Emit = () => Effect.fail(new AgentError('Turn not started'))
          const startTurn = f.agent.startTurn
          f.agent.startTurn = (input, publish) =>
            Effect.suspend(() => {
              emit = publish
              return startTurn(input, publish)
            })
          const orch = yield* createOrchestrator(store, f.agent, f.hub, null, f.attachments)
          const { turnId } = yield* orch.startTurnEffect({ threadId: f.thread.id, text: 'first' })
          const file = kind === 'image' ? 'image.png' : 'video.mp4'
          yield* f.fs.writeFileString(f.home + '/' + file, 'media')
          const host = {
            resolveAttachment: () => Effect.fail(new Error('Attachment not found')),
            attachments: f.attachments,
            projectPath: f.home,
            turnId: () => turnId,
            emit: (event: Parameters<Emit>[0], _turnId: string, onCommit: Effect.Effect<void>) =>
              emit(event, onCommit),
          }
          const invoke =
            kind === 'image'
              ? yield* createSendImagesTool(host).pipe(
                  Effect.map(
                    (tool) => (signal: AbortSignal) =>
                      tool.handler({ paths: [file], caption: undefined }, { signal })
                  )
                )
              : yield* createSendVideoTool(host).pipe(
                  Effect.map(
                    (tool) => (signal: AbortSignal) =>
                      tool.handler({ path: file, caption: undefined }, { signal })
                  )
                )
          const controller = new AbortController()
          const pending = invoke(controller.signal).then(
            () => 'completed',
            () => 'rejected'
          )
          if (failure === 'abort') {
            yield* Deferred.await(entered)
            controller.abort()
            yield* Deferred.succeed(release, undefined)
          }
          expect(yield* Effect.promise(() => pending)).toBe('rejected')
          const events = yield* f.store.getEventsAfter(f.thread.id, 0)
          const event = events.find(
            ({ event }) => event.type === 'item.started' && event.item.kind === itemKind
          )?.event
          if (
            !event ||
            event.type !== 'item.started' ||
            (event.item.kind !== 'image_gallery' && event.item.kind !== 'video')
          )
            throw new Error('Missing durable media item')
          const attachment = event.item.kind === 'video' ? event.item.video : event.item.images[0]!
          const resolved = yield* f.attachments.resolve(attachment.id)
          expect(resolved).not.toBeNull()
          expect(yield* f.fs.readFileString(resolved!.path)).toBe('media')
          expect(yield* f.fs.readDirectory(f.attachments.dir)).toHaveLength(1)
        })
      )
    })
  }
}

for (const admission of ['initial', 'steered'] as const) {
  for (const write of ['first', 'second'] as const) {
    test(`${admission} upload batch failure at its ${write} write removes only unreferenced files`, async () => {
      await runUploadTest(
        Effect.gen(function* () {
          const f = yield* makeUploadFixture()
          const orch = yield* createOrchestrator(f.store, f.agent, f.hub, null, f.attachments)
          if (admission === 'steered') {
            yield* orch.startTurnEffect({
              threadId: f.thread.id,
              text: 'first',
              attachments: [upload],
            })
          }
          const existing = yield* f.fs.readDirectory(f.attachments.dir)
          yield* f.sql.unsafe(`CREATE TRIGGER reject_upload BEFORE INSERT ON thread_events
          WHEN json_extract(NEW.payload_json, '$.type') = '${write === 'first' ? 'item.started' : 'item.completed'}'
          BEGIN SELECT RAISE(ABORT, 'injected batch write failure'); END`)
          const result = yield* Effect.exit(
            orch.startTurnEffect({ threadId: f.thread.id, text: 'rejected', attachments: [upload] })
          )
          expect(Exit.isFailure(result)).toBe(true)
          expect(yield* f.fs.readDirectory(f.attachments.dir)).toEqual(existing)
          const events = yield* f.store.getEventsAfter(f.thread.id, 0)
          const userMessages = events.filter(
            ({ event }) => event.type === 'item.started' && event.item.kind === 'user_message'
          )
          expect(userMessages).toHaveLength(admission === 'steered' ? 1 : 0)
          expect(
            userMessages.some(
              ({ event }) =>
                event.type === 'item.started' &&
                event.item.kind === 'user_message' &&
                event.item.text === 'rejected'
            )
          ).toBe(false)
        })
      )
    })
  }
}

test('late steering rejection removes the new upload but retains the active turn attachment', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      f.agent.steer = () => Effect.succeed(false)
      const orch = yield* createOrchestrator(f.store, f.agent, f.hub, null, f.attachments)
      yield* orch.startTurnEffect({ threadId: f.thread.id, text: 'first', attachments: [upload] })
      const existing = yield* f.fs.readDirectory(f.attachments.dir)
      const before = yield* f.store.getEventsAfter(f.thread.id, 0)
      const result = yield* Effect.exit(
        orch.startTurnEffect({ threadId: f.thread.id, text: 'late', attachments: [upload] })
      )
      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toEqual(existing)
      expect(yield* f.store.getEventsAfter(f.thread.id, 0)).toEqual(before)
    })
  )
})

test('cancelling uploaded steering before durable admission reclaims its file', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      const entered = yield* Deferred.make<void>()
      f.agent.steer = () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
      const orch = yield* createOrchestrator(f.store, f.agent, f.hub, null, f.attachments)
      yield* orch.startTurnEffect({ threadId: f.thread.id, text: 'first' })
      const before = yield* f.store.getEventsAfter(f.thread.id, 0)
      const pending = yield* orch
        .startTurnEffect({ threadId: f.thread.id, text: 'cancelled', attachments: [upload] })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toHaveLength(1)
      yield* Fiber.interrupt(pending)
      expect(Exit.hasInterrupts(yield* Fiber.await(pending))).toBe(true)
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toEqual([])
      expect(yield* f.store.getEventsAfter(f.thread.id, 0)).toEqual(before)
    })
  )
})

test('cancellation while waiting for admission never persists the queued upload', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      const entered = yield* Deferred.make<void>()
      const persisted: string[] = []
      const persist = f.attachments.persist
      f.attachments.persist = (uploads) =>
        Effect.suspend(() => {
          for (const upload of uploads ?? []) persisted.push(upload.name)
          return persist(uploads)
        })
      f.agent.steer = () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
      const orch = yield* createOrchestrator(f.store, f.agent, f.hub, null, f.attachments)
      yield* orch.startTurnEffect({ threadId: f.thread.id, text: 'first' })
      const holder = yield* orch
        .startTurnEffect({ threadId: f.thread.id, text: 'holding', attachments: [upload] })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      const waiting = yield* orch
        .startTurnEffect({
          threadId: f.thread.id,
          text: 'queued',
          attachments: [{ ...upload, name: 'queued.png' }],
        })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Fiber.interrupt(waiting)
      expect(Exit.hasInterrupts(yield* Fiber.await(waiting))).toBe(true)
      expect(persisted).toEqual(['image.png'])
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toHaveLength(1)
      yield* Fiber.interrupt(holder)
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toEqual([])
    })
  )
})

test('cancelling an initial upload while waiting to publish reclaims its file without committing a user batch', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      const held = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const persisted = yield* Deferred.make<void>()
      const persist = f.attachments.persist
      f.attachments.persist = (uploads) =>
        persist(uploads).pipe(Effect.tap(() => Deferred.succeed(persisted, undefined)))
      const orch = yield* createOrchestrator(f.store, f.agent, f.hub, null, f.attachments)
      const holder = yield* orch
        .withPublication(
          f.thread.id,
          Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release)))
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(held)
      const pending = yield* orch
        .startTurnEffect({ threadId: f.thread.id, text: 'cancelled', attachments: [upload] })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(persisted)
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toHaveLength(1)
      const interrupted = yield* Fiber.interrupt(pending).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(holder)
      yield* Fiber.join(interrupted)
      expect(Exit.hasInterrupts(yield* Fiber.await(pending))).toBe(true)
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toEqual([])
      const events = yield* f.store.getEventsAfter(f.thread.id, 0)
      expect(events.some(({ event }) => event.type === 'item.started')).toBe(false)
      expect(yield* orch.isActive(f.thread.id)).toBe(false)
    })
  )
})

test('agent startup failure after a durable user batch retains its referenced attachment', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      f.agent.startTurn = () => Effect.fail(new AgentError('start failed'))
      const orch = yield* createOrchestrator(f.store, f.agent, f.hub, null, f.attachments)
      const result = yield* Effect.exit(
        orch.startTurnEffect({ threadId: f.thread.id, text: 'durable', attachments: [upload] })
      )
      expect(Exit.isFailure(result)).toBe(true)
      const events = yield* f.store.getEventsAfter(f.thread.id, 0)
      expect(events.map(({ event }) => event.type)).toEqual([
        'item.started',
        'item.completed',
        'turn.failed',
      ])
      const item = events[0]!.event
      if (item.type !== 'item.started' || item.item.kind !== 'user_message')
        throw new Error('Missing durable user message')
      const attachment = item.item.attachments[0]!
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toEqual([`${attachment.id}.png`])
      const resolved = yield* f.attachments.resolve(attachment.id)
      expect(yield* f.fs.readFileString(resolved!.path)).toBe('image')
    })
  )
})

test('publication failure after the durable user batch retains its referenced attachment', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      f.hub.pushThread = () => {
        throw new Error('publication failed')
      }
      const orch = yield* createOrchestrator(f.store, f.agent, f.hub, null, f.attachments)
      const result = yield* Effect.exit(
        orch.startTurnEffect({ threadId: f.thread.id, text: 'durable', attachments: [upload] })
      )
      expect(Exit.isFailure(result)).toBe(true)
      const events = yield* f.store.getEventsAfter(f.thread.id, 0)
      const item = events[0]!.event
      if (item.type !== 'item.started' || item.item.kind !== 'user_message')
        throw new Error('Missing durable user message')
      const attachment = item.item.attachments[0]!
      expect(yield* f.fs.readDirectory(f.attachments.dir)).toEqual([`${attachment.id}.png`])
      expect(yield* f.attachments.resolve(attachment.id)).not.toBeNull()
    })
  )
})

test('failed initial and cleanup appends release orchestrator admission for retry', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jetty-orchestrator-'))
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(storeLayer.pipe(Layer.provide(databaseLayer(home))))
          const store = Context.get(context, Store)
          const project = yield* store.createProject(home)
          const thread = yield* store.createThread(project.id, newId())
          let failWrites = true
          const attempts: string[] = []
          const orch = yield* createOrchestrator(
            {
              ...store,
              appendEvents(threadId, events) {
                return Effect.suspend(() => {
                  attempts.push(events[0].type)
                  if (failWrites) return Effect.fail(new StoreError('internal', 'write failed'))
                  return store.appendEvents(threadId, events)
                })
              },
              appendEvent(threadId, event) {
                return Effect.suspend(() => {
                  attempts.push(event.type)
                  if (failWrites) return Effect.fail(new StoreError('internal', 'write failed'))
                  return store.appendEvent(threadId, event)
                })
              },
            },
            yield* createEchoAdapter(),
            createHub()
          )
          const failed = yield* Effect.exit(
            orch.startTurnEffect({ threadId: thread.id, text: 'first' })
          )
          expect(Exit.isFailure(failed)).toBe(true)
          expect(attempts).toEqual(['item.started', 'turn.failed'])
          expect(yield* orch.isActive(thread.id)).toBe(false)
          failWrites = false
          const retry = yield* orch.startTurnEffect({ threadId: thread.id, text: 'retry' })
          yield* TestClock.adjust(1000)
          expect(yield* orch.isActive(thread.id)).toBe(false)
          const events = yield* store.getEventsAfter(thread.id, 0)
          expect(events.filter(({ event }) => event.type === 'turn.started')).toHaveLength(1)
          expect(events.filter(({ event }) => event.type === 'turn.completed')).toMatchObject([
            { event: { turnId: retry.turnId } },
          ])
        })
      ).pipe(Effect.provide(TestClock.layer()), Effect.provide(BunServices.layer))
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

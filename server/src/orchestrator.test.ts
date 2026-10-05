import { BunServices } from '@effect/platform-bun'
import { RESTART_LIMIT_NOTE } from '@jetty/shared/items'
import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Queue, Scope } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Worktrees } from './worktrees'

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
          const orch = yield* createOrchestrator({
            store,
            agent: f.agent,
            hub: f.hub,
            attachments: f.attachments,
          })
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
          const orch = yield* createOrchestrator({
            store: f.store,
            agent: f.agent,
            hub: f.hub,
            attachments: f.attachments,
          })
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
      const orch = yield* createOrchestrator({
        store: f.store,
        agent: f.agent,
        hub: f.hub,
        attachments: f.attachments,
      })
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
      const orch = yield* createOrchestrator({
        store: f.store,
        agent: f.agent,
        hub: f.hub,
        attachments: f.attachments,
      })
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
      const orch = yield* createOrchestrator({
        store: f.store,
        agent: f.agent,
        hub: f.hub,
        attachments: f.attachments,
      })
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
      const orch = yield* createOrchestrator({
        store: f.store,
        agent: f.agent,
        hub: f.hub,
        attachments: f.attachments,
      })
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
      const orch = yield* createOrchestrator({
        store: f.store,
        agent: f.agent,
        hub: f.hub,
        attachments: f.attachments,
      })
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
      const orch = yield* createOrchestrator({
        store: f.store,
        agent: f.agent,
        hub: f.hub,
        attachments: f.attachments,
      })
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
          const orch = yield* createOrchestrator({
            store: {
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
            agent: yield* createEchoAdapter(),
            hub: createHub(),
          })
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

for (const stopped of [false, true]) {
  test(
    stopped
      ? 'a queue-paused grandchild does not block its child reporting to the parent'
      : 'reports travel up a parent, child and grandchild chain only after the child settles',
    async () => {
      await runUploadTest(
        Effect.gen(function* () {
          const f = yield* makeUploadFixture()
          const parent = f.thread
          const child = yield* f.store.createThread(parent.projectId, newId())
          yield* f.store.markAgentThread(child.id, parent.id, true)
          const grandchild = yield* f.store.createThread(parent.projectId, newId())
          yield* f.store.markAgentThread(grandchild.id, child.id, true)
          const turns = new Map<string, { turnId: string; finish: Deferred.Deferred<string> }>()
          const childWoken = yield* Deferred.make<void>()
          f.agent.startTurn = (input, emit) =>
            Effect.gen(function* () {
              const finish = yield* Deferred.make<string>()
              const wakingChild = input.threadId === child.id && turns.has(child.id)
              turns.set(input.threadId, { turnId: input.turnId, finish })
              yield* emit({ type: 'turn.started', turnId: input.turnId })
              if (wakingChild) yield* Deferred.succeed(childWoken, undefined)
              return {
                await: Effect.gen(function* () {
                  const text = yield* Deferred.await(finish)
                  const itemId = newId()
                  yield* emit({
                    type: 'item.started',
                    item: {
                      id: itemId,
                      turnId: input.turnId,
                      createdAt: Date.now(),
                      kind: 'assistant_message',
                      text,
                    },
                  })
                  yield* emit({ type: 'item.completed', itemId })
                  yield* emit({ type: 'turn.completed', turnId: input.turnId })
                }),
              }
            })
          const orch = yield* createOrchestrator({
            store: f.store,
            agent: f.agent,
            hub: f.hub,
          })
          yield* f.store.setQueuePaused(parent.id, true)
          for (const [sender, recipient] of [
            [parent, child],
            [child, grandchild],
          ] as const) {
            const message = {
              id: newId(),
              text: 'Please do the work',
              createdAt: Date.now(),
              hop: 1,
              from: { threadId: sender.id, title: sender.title },
            }
            yield* f.store.enqueue(recipient.id, message)
            yield* orch.startTurnEffect({
              threadId: recipient.id,
              text: message.text,
              queued: message,
            })
          }
          const firstChildTurn = turns.get(child.id)!
          yield* Deferred.succeed(firstChildTurn.finish, 'Interim child answer')
          yield* TestClock.adjust(1000)
          expect(yield* orch.isActive(child.id)).toBe(false)
          expect(yield* orch.isActive(grandchild.id)).toBe(true)
          yield* f.store.setQueuePaused(child.id, true)
          yield* orch.resumeQueues()
          yield* TestClock.adjust(1000)
          expect((yield* f.store.requireThread(parent.id)).pendingMessages ?? []).toEqual([])

          if (stopped) {
            yield* f.store.setQueuePaused(grandchild.id, true)
            yield* f.store.enqueue(grandchild.id, {
              id: newId(),
              text: 'Work left for later',
              createdAt: Date.now(),
              hop: 0,
            })
          }
          yield* Deferred.succeed(turns.get(grandchild.id)!.finish, 'Grandchild final answer')
          yield* TestClock.adjust(1000)
          expect(yield* orch.isActive(grandchild.id)).toBe(false)

          if (stopped) {
            expect((yield* f.store.requireThread(grandchild.id)).queuePaused).toBe(true)
            expect((yield* f.store.requireThread(grandchild.id)).pendingMessages).toHaveLength(1)
          } else {
            const reports = (yield* f.store.requireThread(child.id)).pendingMessages ?? []
            expect(reports).toHaveLength(1)
            expect(reports[0]).toMatchObject({ kind: 'report', from: { threadId: grandchild.id } })
            expect(reports[0]!.text).toContain('Grandchild final answer')
            expect((yield* f.store.requireThread(parent.id)).pendingMessages ?? []).toEqual([])
            yield* f.store.setQueuePaused(child.id, false)
            yield* Queue.offer(f.store.queueChanges, undefined)
            yield* Deferred.await(childWoken)
            const lastChildTurn = turns.get(child.id)!
            expect(lastChildTurn.turnId).not.toBe(firstChildTurn.turnId)
            expect(yield* orch.isActive(child.id)).toBe(true)
            expect(
              yield* f.sql`SELECT initiator_thread_id FROM orchestration_turns WHERE turn_id = ${lastChildTurn.turnId}`
            ).toEqual([{ initiator_thread_id: parent.id }])
            yield* Deferred.succeed(lastChildTurn.finish, 'Final child answer after grandchild')
            yield* TestClock.adjust(1000)
          }
          const reports = (yield* f.store.requireThread(parent.id)).pendingMessages ?? []
          expect(reports).toHaveLength(1)
          expect(reports[0]).toMatchObject({ kind: 'report', from: { threadId: child.id } })
          expect(reports[0]!.text).toContain(
            stopped ? 'Interim child answer' : 'Final child answer after grandchild'
          )
          if (!stopped) expect(reports[0]!.text).not.toContain('Interim child answer')
          expect(yield* f.store.reportSettledChild(child.id)).toEqual({ delivered: false })
          yield* TestClock.adjust(3000)
          expect((yield* f.store.requireThread(parent.id)).pendingMessages).toEqual(reports)
        }).pipe(Effect.provide(TestClock.layer()))
      )
    }
  )
}

test("a queued message that fails to start reports its error under the thread's publication lock", async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      const orch = yield* createOrchestrator({ store: f.store, agent: f.agent, hub: f.hub })
      yield* f.store.setThreadProviderIfAbsent(f.thread.id, 'missing')
      yield* f.store.enqueue(f.thread.id, {
        id: newId(),
        text: 'queued',
        createdAt: Date.now(),
        hop: 0,
      })
      const held = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const holder = yield* orch
        .withPublication(
          f.thread.id,
          Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release)))
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(held)
      yield* orch.resumeQueues()
      yield* TestClock.adjust(100)
      expect(yield* f.store.getEventsAfter(f.thread.id, 0)).toEqual([])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(holder)
      yield* TestClock.adjust(100)
      expect(yield* f.store.getEventsAfter(f.thread.id, 0)).toMatchObject([
        {
          event: {
            type: 'item.started',
            item: { kind: 'error', message: expect.stringContaining('missing') },
          },
        },
      ])
      expect((yield* f.store.requireThread(f.thread.id)).queuePaused).toBe(true)
    }).pipe(Effect.provide(TestClock.layer()))
  )
})

test('Resume still continues a child the restart guard held after its report failed to deliver', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      const parent = f.thread
      const child = yield* f.store.createThread(parent.projectId, newId())
      yield* f.store.markAgentThread(child.id, parent.id, true)
      const message = {
        id: newId(),
        text: 'Please do the work',
        createdAt: Date.now(),
        hop: 1,
        from: { threadId: parent.id, title: parent.title },
      }
      yield* f.store.enqueue(child.id, message)
      yield* f.store.beginDelivery(child.id, 'held-turn', 1, message.id)
      yield* f.store.appendEvent(child.id, {
        type: 'turn.failed',
        turnId: 'held-turn',
        error: 'server_restarted',
      })
      yield* f.store.appendEvent(child.id, {
        type: 'item.started',
        item: {
          id: newId(),
          turnId: 'held-turn',
          createdAt: Date.now(),
          kind: 'error',
          message: RESTART_LIMIT_NOTE,
        },
      })
      yield* f.store.setQueuePaused(child.id, true)
      yield* f.store.archiveThread(parent.id, true)
      const orch = yield* createOrchestrator({ store: f.store, agent: f.agent, hub: f.hub })
      yield* orch.resumeQueues()
      yield* TestClock.adjust(1000)
      expect((yield* f.store.getThreadState(child.id)).items.at(-1)).toMatchObject({
        kind: 'error',
        message: 'Report to parent was not delivered: parent is archived.',
      })
      yield* orch.continueThread(child.id)
      yield* TestClock.adjust(1000)
      expect((yield* f.store.getThreadState(child.id)).items.at(-1)).toMatchObject({
        kind: 'user_message',
        from: { threadId: child.id, title: 'Jetty' },
      })
    }).pipe(Effect.provide(TestClock.layer()))
  )
})

type ScriptedTurn = { turnId: string; emit: Emit; done: Deferred.Deferred<void> }

// A parent with a notifying child whose agent turns the test drives through each turn's emit.
function makeChildFixture(provider?: 'codex') {
  return Effect.gen(function* () {
    const f = yield* makeUploadFixture()
    const parent = f.thread
    const child = yield* f.store.createThread(parent.projectId, newId())
    yield* f.store.markAgentThread(child.id, parent.id, true)
    if (provider) yield* f.store.setThreadProviderIfAbsent(child.id, provider)
    const turns = new Map<string, ScriptedTurn>()
    f.agent.startTurn = (input, emit) =>
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>()
        turns.set(input.threadId, { turnId: input.turnId, emit, done })
        yield* emit({ type: 'turn.started', turnId: input.turnId })
        return { await: Deferred.await(done) }
      })
    const orch = yield* createOrchestrator({ store: f.store, agent: f.agent, hub: f.hub })
    yield* f.store.setQueuePaused(parent.id, true)
    const message = {
      id: newId(),
      text: 'Please do the work',
      createdAt: Date.now(),
      hop: 1,
      from: { threadId: parent.id, title: parent.title },
    }
    yield* f.store.enqueue(child.id, message)
    yield* orch.startTurnEffect({ threadId: child.id, text: message.text, queued: message })
    const reports = f.store
      .requireThread(parent.id)
      .pipe(Effect.map((thread) => thread.pendingMessages ?? []))
    return { ...f, parent, child, orch, turn: turns.get(child.id)!, turns, reports }
  })
}

function say({ emit, turnId }: ScriptedTurn, text: string) {
  const id = newId()
  return emit({
    type: 'item.started',
    item: { id, turnId, createdAt: Date.now(), kind: 'assistant_message', text },
  }).pipe(Effect.andThen(emit({ type: 'item.completed', itemId: id })))
}

function runSubagent({ emit, turnId }: ScriptedTurn, id: string) {
  return emit({
    type: 'item.started',
    item: {
      id,
      turnId,
      createdAt: Date.now(),
      kind: 'subagent',
      title: 'Explorer',
      prompt: 'Explore',
      status: 'running',
    },
  })
}

function endTurn({ emit, turnId, done }: ScriptedTurn) {
  return emit({ type: 'turn.completed', turnId }).pipe(
    Effect.andThen(Deferred.succeed(done, undefined))
  )
}

test('a child its background work wakes into a turn of its own reports that turn’s answer', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeChildFixture()
      yield* runSubagent(f.turn, 'background')
      yield* say(f.turn, 'Interim answer')
      yield* endTurn(f.turn)
      yield* f.orch.resumeQueues()
      yield* TestClock.adjust(1000)
      expect(yield* f.reports).toEqual([])
      const woken: ScriptedTurn = { ...f.turn, turnId: newId() }
      yield* woken.emit({
        type: 'item.completed',
        itemId: 'background',
        patch: { status: 'completed' },
      })
      yield* woken.emit({ type: 'turn.started', turnId: woken.turnId })
      yield* say(woken, 'Final answer')
      yield* woken.emit({ type: 'turn.completed', turnId: woken.turnId })
      yield* TestClock.adjust(1000)
      const reports = yield* f.reports
      expect(reports).toHaveLength(1)
      expect(reports[0]!.text).toContain('Final answer')
      expect(reports[0]!.text).not.toContain('Interim answer')
    }).pipe(Effect.provide(TestClock.layer()))
  )
})

test("a child's question reaches its parent when its turn ends, while its background work runs on", async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeChildFixture()
      yield* runSubagent(f.turn, 'background')
      f.hub.setBackgroundTasks(f.child.id, [
        { id: 'monitor', label: 'Watching the build', startedAt: Date.now() },
      ])
      yield* f.store.askParent(f.child.id, 'Which database should I use?')
      yield* say(f.turn, 'Asked my parent.')
      yield* endTurn(f.turn)
      yield* f.orch.resumeQueues()
      yield* TestClock.adjust(1000)
      expect(yield* f.reports).toMatchObject([
        {
          kind: 'report',
          reports: [{ outcome: 'asked', question: 'Which database should I use?' }],
        },
      ])
      expect((yield* f.store.requireThread(f.child.id)).awaitingParent).toBe(true)
    }).pipe(Effect.provide(TestClock.layer()))
  )
})

test('a Codex child that ends its turn asking the user reports once the answer’s turn ends', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeChildFixture('codex')
      const questionId = newId()
      yield* f.turn.emit({
        type: 'item.started',
        item: {
          id: questionId,
          turnId: f.turn.turnId,
          createdAt: Date.now(),
          kind: 'question',
          delivery: 'async',
          questions: [{ question: 'Which database?', header: '', multiSelect: false, options: [] }],
        },
      })
      yield* say(f.turn, 'I asked which database to use.')
      yield* endTurn(f.turn)
      yield* f.orch.resumeQueues()
      yield* TestClock.adjust(1000)
      expect(yield* f.reports).toEqual([])
      yield* f.orch.respondQuestion(f.child.id, questionId, { 'Which database?': 'Postgres' })
      const answered = f.turns.get(f.child.id)!
      expect(answered.turnId).not.toBe(f.turn.turnId)
      yield* say(answered, 'Set it up on Postgres.')
      yield* endTurn(answered)
      yield* TestClock.adjust(1000)
      const reports = yield* f.reports
      expect(reports).toMatchObject([{ kind: 'report', reports: [{ outcome: 'finished' }] }])
      expect(reports[0]!.text).toContain('Set it up on Postgres.')
    }).pipe(Effect.provide(TestClock.layer()))
  )
})

test('a refused archive fails with the archive script’s own error', async () => {
  await runUploadTest(
    Effect.gen(function* () {
      const f = yield* makeUploadFixture()
      const worktrees = {
        stopSetup: () => false,
        dirty: async () => 0,
        cleanUp: async () => {
          throw new Error('Worktree archive failed: docker is not running')
        },
      } as unknown as Worktrees
      const orch = yield* createOrchestrator({
        store: f.store,
        agent: f.agent,
        hub: f.hub,
        worktrees,
      })
      const refused = yield* Effect.flip(orch.archiveThread(f.thread.id, true))
      expect(refused.message).toBe('Worktree archive failed: docker is not running')
      expect((yield* f.store.requireThread(f.thread.id)).archived).toBe(false)
    })
  )
})

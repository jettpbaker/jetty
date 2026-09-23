import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadUpdate } from '@jetty/shared/rpc'

import { BunServices } from '@effect/platform-bun'
import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Stream } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Agent, type Emit } from './agent'
import { databaseLayer } from './db'
import { GitDiffLive } from './diff'
import { FileBrowserLive } from './fs-browse'
import { FileSearchLive } from './fs-search'
import { createHub } from './hub'
import { createOrchestrator } from './orchestrator'
import { SkillsLive } from './skills'
import { Store, storeLayer } from './store'
import { threadSubscription } from './ws'

for (const replay of [false, true]) {
  for (const first of ['read', 'append'] as const) {
    test(`${replay ? 'replay' : 'snapshot'} subscription orders live publication when ${first} is suspended`, async () => {
      const home = mkdtempSync(join(tmpdir(), 'jetty-ws-order-'))
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const messages: ThreadUpdate[] = []
      const received = Deferred.makeUnsafe<void>()
      let readStarted = false
      let publish: Emit = () => Effect.die('Turn not started')
      const service = Context.Service<Effect.Success<ReturnType<typeof make>>>('test/Ordering')
      function make() {
        return Effect.gen(function* () {
          const context = yield* Layer.build(storeLayer.pipe(Layer.provide(databaseLayer(home))))
          const base = Context.get(context, Store)
          const project = yield* base.createProject(home)
          const thread = yield* base.createThread(project.id, newId())
          const store: Store = {
            ...base,
            getThreadState(id) {
              return Effect.gen(function* () {
                readStarted = true
                const value = yield* base.getThreadState(id)
                if (first === 'read') {
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                }
                return value
              })
            },
            appendEvent(id, event) {
              return Effect.gen(function* () {
                if (first === 'append' && event.type === 'turn.started') {
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                }
                return yield* base.appendEvent(id, event)
              })
            },
          }
          const agent: Agent = {
            startTurn(_input, emit) {
              publish = emit
              return Effect.succeed({ await: Effect.never })
            },
            steer: () => Effect.succeed(false),
            interrupt: () => Effect.void,
            respondToApproval: () => Effect.succeed(false),
            respondToQuestion: () => Effect.succeed(false),
          }
          const hub = createHub()
          const orch = yield* createOrchestrator({ store, agent, hub })
          const { turnId } = yield* orch.startTurnEffect({ threadId: thread.id, text: 'hello' })
          return { store, base, hub, orch, thread, turnId }
        })
      }
      const runtime = ManagedRuntime.make(
        Layer.mergeAll(
          Layer.effect(service, make()),
          FileBrowserLive,
          FileSearchLive,
          SkillsLive,
          GitDiffLive
        ).pipe(Layer.provide(BunServices.layer))
      )
      try {
        const fixture = await runtime.runPromise(service)
        let subscription: Fiber.Fiber<void, unknown> | undefined
        const event: ThreadEvent = { type: 'turn.started', turnId: fixture.turnId }
        function subscribe() {
          subscription = runtime.runFork(
            threadSubscription(fixture.store, fixture.orch, fixture.hub, {
              threadId: fixture.thread.id,
              ...(replay ? { afterSeq: 0 } : {}),
            }).pipe(
              Stream.runForEach((update) =>
                Effect.gen(function* () {
                  messages.push(update)
                  if (
                    (first === 'read' && update.type === 'event' && update.seq === 4) ||
                    (first === 'append' && update.type !== 'event')
                  )
                    yield* Deferred.succeed(received, undefined)
                })
              )
            )
          )
        }
        let append: Promise<void>
        let second: Promise<void>
        if (first === 'read') {
          subscribe()
          await runtime.runPromise(Deferred.await(entered))
          append = runtime.runPromise(publish(event))
          second = runtime.runPromise(
            publish({ type: 'session.status', status: 'awaiting_approval' })
          )
          expect(messages).toEqual([])
          expect(
            (await runtime.runPromise(fixture.base.getThreadState(fixture.thread.id))).lastSeq
          ).toBe(2)
        } else {
          append = runtime.runPromise(publish(event))
          await runtime.runPromise(Deferred.await(entered))
          second = runtime.runPromise(
            publish({ type: 'session.status', status: 'awaiting_approval' })
          )
          subscribe()
          expect(readStarted).toBe(false)
          expect(messages).toEqual([])
        }
        await runtime.runPromise(Deferred.succeed(release, undefined))
        await Promise.all([append, second, runtime.runPromise(Deferred.await(received))])
        const pushes = messages.filter((message) => message.type === 'event')
        expect(pushes.map((message) => message.seq)).toEqual(
          replay ? [1, 2, 3, 4] : first === 'read' ? [3, 4] : []
        )
        const response = messages.find((message) => message.type !== 'event')
        const seq = first === 'read' ? 2 : 4
        expect(response).toMatchObject({
          type: replay ? 'ready' : 'snapshot',
          seq,
          ...(!replay ? { snapshot: { lastSeq: seq } } : {}),
        })
        if (first === 'read') expect(messages.at(-1)).toMatchObject({ type: 'event', seq: 4 })
        else expect(messages.at(-1)).toBe(response)
        expect(
          await runtime.runPromise(fixture.base.getEventsAfter(fixture.thread.id, 0))
        ).toHaveLength(4)
        if (subscription) await runtime.runPromise(Fiber.interrupt(subscription))
        expect(await runtime.runPromise(fixture.hub.subscriberCount)).toBe(0)
      } finally {
        await runtime.runPromise(Deferred.succeed(release, undefined))
        await runtime.dispose()
        rmSync(home, { recursive: true, force: true })
      }
    })
  }
}

import type { ThreadEvent } from '@jetty/shared/events'
import type { ServerMessage } from '@jetty/shared/wire'
import type { ServerWebSocket } from 'bun'

import { newId } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'
import { Context, Deferred, Effect, Layer, ManagedRuntime } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Agent, type Emit } from './agent'
import { databaseLayer } from './db'
import { createHub, type ConnData } from './hub'
import { createOrchestrator } from './orchestrator'
import { Store, storeLayer } from './store'
import { createWs } from './ws'

for (const replay of [false, true]) {
  for (const first of ['read', 'append'] as const) {
    test(`${replay ? 'replay' : 'snapshot'} subscription orders live publication when ${first} is suspended`, async () => {
      const home = mkdtempSync(join(tmpdir(), 'jetty-ws-order-'))
      const entered = Deferred.makeUnsafe<void>()
      const release = Deferred.makeUnsafe<void>()
      const messages: ServerMessage[] = []
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
          const orch = yield* createOrchestrator(store, agent, hub)
          const { turnId } = yield* orch.startTurnEffect({ threadId: thread.id, text: 'hello' })
          return { store, base, hub, orch, thread, turnId }
        })
      }
      const runtime = ManagedRuntime.make(Layer.effect(service, make()))
      try {
        const fixture = await runtime.runPromise(service)
        const requests: Promise<void>[] = []
        const ws = createWs(fixture.store, fixture.orch, fixture.hub, (effect) => {
          const request = runtime.runPromise(effect)
          requests.push(request)
          return request
        })
        const socket = {
          readyState: WebSocket.OPEN,
          data: { chrome: false, threads: new Set<string>() },
          send(value: string) {
            messages.push(JSON.parse(value) as ServerMessage)
          },
        } as unknown as ServerWebSocket<ConnData>
        const event: ThreadEvent = { type: 'turn.started', turnId: fixture.turnId }
        function subscribe() {
          ws.handlers.message(
            socket,
            JSON.stringify({
              id: 'subscribe',
              method: 'thread.subscribe',
              params: { threadId: fixture.thread.id, ...(replay ? { afterSeq: 0 } : {}) },
            })
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
        await Promise.all([append, second, ...requests])
        const pushes = messages.filter((message) => 'sub' in message && message.sub === 'thread')
        expect(pushes.map((message) => message.seq)).toEqual(
          replay ? [1, 2, 3, 4] : first === 'read' ? [3, 4] : []
        )
        const response = messages.find((message) => 'id' in message && message.id === 'subscribe')
        const seq = first === 'read' ? 2 : 4
        expect(response).toMatchObject({
          id: 'subscribe',
          ok: true,
          result: { seq, ...(!replay ? { snapshot: { lastSeq: seq } } : {}) },
        })
        if (first === 'read') expect(messages.at(-1)).toMatchObject({ sub: 'thread', seq: 4 })
        else expect(messages.at(-1)).toBe(response)
        expect(
          await runtime.runPromise(fixture.base.getEventsAfter(fixture.thread.id, 0))
        ).toHaveLength(4)
      } finally {
        await runtime.runPromise(Deferred.succeed(release, undefined))
        await runtime.dispose()
        rmSync(home, { recursive: true, force: true })
      }
    })
  }
}

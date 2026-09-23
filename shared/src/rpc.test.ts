import { expect, test } from 'bun:test'
import { Deferred, Effect, Result, Schema, Stream } from 'effect'
import { RpcSchema, RpcTest } from 'effect/unstable/rpc'

import { emptyThread } from './reducer'
import { JettyRpcs, ThreadUpdate } from './rpc'
import { methods, type Project, type WireError } from './wire'

test('RPC operations preserve unary schemas and replace subscription messages with streams', () => {
  expect([...JettyRpcs.requests.keys()].sort()).toEqual(Object.keys(methods).sort())
  for (const [name, rpc] of JettyRpcs.requests) {
    if (
      name === 'chrome.subscribe' ||
      name === 'thread.subscribe' ||
      name === 'pullRequest.subscribe'
    ) {
      expect(RpcSchema.isStreamSchema(rpc.successSchema)).toBe(true)
    } else {
      expect(rpc.payloadSchema).toBe(methods[name as keyof typeof methods].params)
      expect(rpc.successSchema === methods[name as keyof typeof methods].result).toBe(true)
    }
  }
})

test('thread streams validate snapshots, sequenced events, and replay completion watermarks', () => {
  const values: ThreadUpdate[] = [
    { type: 'snapshot', snapshot: emptyThread, seq: 0 },
    { type: 'event', seq: 1, ts: 0, event: { type: 'turn.started', turnId: 'turn' } },
    { type: 'ready', seq: 1 },
  ]
  for (const value of values) {
    const encoded = Schema.encodeSync(Schema.fromJsonString(ThreadUpdate))(value)
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(ThreadUpdate))(encoded)).toEqual(value)
  }
  for (const value of [
    { type: 'snapshot', snapshot: emptyThread, seq: -1 },
    { type: 'event', seq: 0, ts: 0, event: { type: 'turn.started', turnId: 'turn' } },
    { type: 'ready', seq: 0.5 },
    { type: 'ready', seq: Infinity },
    { type: 'ready' },
  ]) {
    expect(Result.isFailure(Schema.decodeUnknownResult(ThreadUpdate)(value))).toBe(true)
  }
})

test('generated RPC clients retain unary types, typed failures, and scoped stream cancellation', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const released = yield* Deferred.make<void>()
        const handlers = JettyRpcs.toLayer({
          'models.refresh': () => Effect.succeed(null),
          'project.create': ({ path }) =>
            Effect.succeed({
              project: { id: 'project', path, title: 'Project', createdAt: 0 },
            }),
          'project.setIcon': () => Effect.succeed(null),
          'fs.browse': ({ partialPath }) =>
            Effect.succeed({ parentPath: partialPath, entries: [] }),
          'fs.search': () => Effect.succeed({ files: [] }),
          'skills.list': () => Effect.succeed({ skills: [] }),
          'thread.create': ({ id, projectId }) =>
            Effect.succeed({
              thread: {
                id,
                projectId,
                title: 'Thread',
                status: 'idle' as const,
                archived: false,
                pinned: false,
                updatedAt: 0,
              },
            }),
          'thread.archive': () => Effect.succeed(null),
          'thread.rename': () => Effect.succeed(null),
          'thread.pin': () => Effect.succeed(null),
          'thread.delete': () => Effect.succeed(null),
          'thread.diff': () => Effect.succeed({ diff: '' }),
          'thread.diffFile': () => Effect.succeed({ before: null, after: null }),
          'pullRequest.link': () =>
            Effect.fail({ code: 'not_found' as const, message: 'Not found' }),
          'pullRequest.unlink': () =>
            Effect.fail({ code: 'not_found' as const, message: 'Not found' }),
          'pullRequest.get': ({ repo, number }) =>
            Effect.succeed({ repo, number, status: 'loading' as const }),
          'pullRequest.refresh': ({ repo, number }) =>
            Effect.succeed({ repo, number, status: 'loading' as const }),
          'pullRequest.subscribe': ({ repo, number }) =>
            Stream.succeed({ repo, number, status: 'loading' as const }),
          'queue.add': () => Effect.succeed(null),
          'queue.edit': () => Effect.succeed(null),
          'queue.remove': () => Effect.succeed(null),
          'queue.sendNow': () => Effect.succeed(null),
          'turn.start': () =>
            Effect.fail({ code: 'not_found' as const, message: 'Thread not found' }),
          'turn.interrupt': () => Effect.succeed(null),
          'workflow.stop': () => Effect.succeed(null),
          'approval.respond': () => Effect.succeed(null),
          'question.respond': () => Effect.succeed(null),
          'question.dismiss': () => Effect.succeed(null),
          'chrome.subscribe': () =>
            Stream.succeed({ type: 'snapshot' as const, projects: [], threads: [] }),
          'thread.subscribe': ({ threadId }) =>
            threadId === 'missing'
              ? Stream.fail({ code: 'not_found' as const, message: 'Thread not found' })
              : Stream.succeed({ type: 'ready' as const, seq: 0 }).pipe(
                  Stream.concat(Stream.never),
                  Stream.ensuring(Deferred.succeed(released, undefined))
                ),
        })
        const client = yield* RpcTest.makeClient(JettyRpcs).pipe(Effect.provide(handlers))
        const result: { readonly project: Project } = yield* client['project.create']({
          path: '/workspace',
        })
        expect(result.project.path).toBe('/workspace')
        const failure: WireError = yield* client['turn.start']({
          threadId: 'missing',
          text: 'hello',
        }).pipe(Effect.flip)
        expect(failure).toEqual({ code: 'not_found', message: 'Thread not found' })
        const streamFailure: WireError = yield* client['thread.subscribe']({
          threadId: 'missing',
        }).pipe(Stream.runCollect, Effect.flip)
        expect(streamFailure).toEqual(failure)
        const updates = yield* client['thread.subscribe']({ threadId: 'thread', afterSeq: 0 }).pipe(
          Stream.take(1),
          Stream.runCollect
        )
        expect(updates).toEqual([{ type: 'ready', seq: 0 }])
        yield* Deferred.await(released)
      })
    )
  )
})

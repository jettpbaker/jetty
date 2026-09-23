import { Deferred, Effect, Queue, Schema, Stream } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

import { AgentError } from './agent'

export type RpcId = string | number
export type RpcMessage = { method: string; params: Record<string, unknown>; id?: RpcId }
export type StdioConnection = {
  request(method: string, params: unknown): Effect.Effect<Record<string, unknown>, AgentError>
  notify(method: string, params: unknown): Effect.Effect<void, AgentError>
  startRequest(method: string, params: unknown): Effect.Effect<RpcId, AgentError>
  respond(id: RpcId, result: unknown): Effect.Effect<void, AgentError>
  reject(id: RpcId, message: string): Effect.Effect<void, AgentError>
  messages: Queue.Dequeue<RpcMessage, AgentError>
}
export type StdioProcessOptions = {
  env?: Record<string, string | undefined>
  command?: string
  args?: string[]
  requestTimeoutMs?: number
}

const Envelope = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  result: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
})

export function openStdioConnection(
  cwd: string,
  options: StdioProcessOptions & {
    command: string
    args: string[]
    name: string
    jsonrpc?: boolean
  }
) {
  return Effect.gen(function* () {
    const outgoing = yield* Queue.make<Uint8Array>()
    const messages = yield* Queue.make<RpcMessage, AgentError>()
    const pending = new Map<RpcId, Deferred.Deferred<Record<string, unknown>, AgentError>>()
    const detached = new Set<RpcId>()
    let nextId = 0
    let failure: AgentError | undefined
    const child = yield* ChildProcess.make(options.command, options.args, {
      cwd,
      env: options.env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      forceKillAfter: '1 second',
    }).pipe(
      Effect.mapError(
        (error) => new AgentError(`Unable to launch ${options.name}: ${error.message}`)
      )
    )

    function fail(error: AgentError) {
      return Effect.gen(function* () {
        failure ??= error
        for (const waiter of pending.values()) yield* Deferred.fail(waiter, failure)
        pending.clear()
        yield* Queue.fail(messages, failure)
      })
    }

    function send(message: unknown) {
      return Effect.suspend(() => {
        if (failure) return Effect.fail(failure)
        return Queue.offer(
          outgoing,
          new TextEncoder().encode(
            JSON.stringify(options.jsonrpc ? { jsonrpc: '2.0', ...object(message) } : message) +
              '\n'
          )
        ).pipe(Effect.asVoid)
      })
    }

    yield* Effect.addFinalizer(() => fail(new AgentError(options.name + ' connection closed')))
    yield* Stream.fromQueue(outgoing).pipe(
      Stream.run(child.stdin),
      Effect.catch(() => fail(new AgentError(options.name + ' stdin closed'))),
      Effect.forkScoped
    )
    // Drain stderr without copying provider diagnostics (which may contain prompts) into the ledger.
    yield* child.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped)
    yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) =>
        Effect.gen(function* () {
          if (!line.trim()) return
          const message = yield* Effect.try({
            try: () => Schema.decodeUnknownSync(Envelope)(JSON.parse(line)),
            catch: () => new AgentError(options.name + ' invalid protocol message'),
          })
          if (message.method) {
            yield* Queue.offer(messages, {
              method: message.method,
              params: message.params ?? {},
              ...(message.id === undefined ? {} : { id: message.id }),
            })
          } else if (message.id !== undefined) {
            // Prompt completions share the stream queue so earlier deltas publish first.
            if (detached.delete(message.id)) {
              yield* Queue.offer(messages, {
                method: '$response',
                params: {
                  requestId: message.id,
                  result: message.result ?? {},
                  error: message.error,
                },
              })
              return
            }
            const waiter = pending.get(message.id)
            if (!waiter) return
            pending.delete(message.id)
            if (message.error) yield* Deferred.fail(waiter, new AgentError(message.error.message))
            else yield* Deferred.succeed(waiter, message.result ?? {})
          }
        })
      ),
      Effect.mapError((error) => new AgentError(error.message)),
      Effect.matchEffect({
        onFailure: fail,
        onSuccess: () => fail(new AgentError(options.name + ' stream ended')),
      }),
      Effect.forkScoped
    )
    const connection: StdioConnection = {
      messages,
      notify: (method, params) => send({ method, params }),
      startRequest(method, params) {
        return Effect.gen(function* () {
          const id = ++nextId
          detached.add(id)
          yield* send({ id, method, params })
          return id
        })
      },
      request(method, params) {
        return Effect.gen(function* () {
          const id = ++nextId
          const result = yield* Deferred.make<Record<string, unknown>, AgentError>()
          pending.set(id, result)
          return yield* send({ id, method, params }).pipe(
            Effect.andThen(Deferred.await(result)),
            Effect.timeout(options.requestTimeoutMs ?? 30_000),
            Effect.mapError((error) => new AgentError(`${method}: ${error.message}`)),
            Effect.ensuring(Effect.sync(() => pending.delete(id)))
          )
        })
      },
      respond: (id, result) => send({ id, result }),
      reject: (id, message) => send({ id, error: { code: -32601, message } }),
    }
    return connection
  })
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

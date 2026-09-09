import { Deferred, Effect, Queue, Schema, Stream } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

import { AgentError } from './agent'

export type RpcId = string | number
export type RpcMessage = { method: string; params: Record<string, unknown>; id?: RpcId }
export type CodexConnection = {
  request(method: string, params: unknown): Effect.Effect<Record<string, unknown>, AgentError>
  respond(id: RpcId, result: unknown): Effect.Effect<void, AgentError>
  reject(id: RpcId, message: string): Effect.Effect<void, AgentError>
  messages: Queue.Dequeue<RpcMessage, AgentError>
}
export type CodexProcessOptions = { command?: string; args?: string[]; requestTimeoutMs?: number }

const Envelope = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  result: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
})

export function openCodexConnection(cwd: string, options: CodexProcessOptions = {}) {
  return Effect.gen(function* () {
    const outgoing = yield* Queue.make<Uint8Array>()
    const messages = yield* Queue.make<RpcMessage, AgentError>()
    const pending = new Map<RpcId, Deferred.Deferred<Record<string, unknown>, AgentError>>()
    let nextId = 0
    let failure: AgentError | undefined
    const child = yield* ChildProcess.make(
      options.command ?? process.env.JETTY_CODEX_BIN ?? 'codex',
      options.args ?? ['app-server', '--listen', 'stdio://'],
      { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', forceKillAfter: '1 second' }
    ).pipe(Effect.mapError((error) => new AgentError(`Unable to launch Codex: ${error.message}`)))

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
        return Queue.offer(outgoing, new TextEncoder().encode(JSON.stringify(message) + '\n')).pipe(
          Effect.asVoid
        )
      })
    }

    yield* Effect.addFinalizer(() => fail(new AgentError('Codex connection closed')))
    yield* Stream.fromQueue(outgoing).pipe(
      Stream.run(child.stdin),
      Effect.catch(() => fail(new AgentError('Codex stdin closed'))),
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
            catch: () => new AgentError('Invalid Codex protocol message'),
          })
          if (message.method) {
            yield* Queue.offer(messages, {
              method: message.method,
              params: message.params ?? {},
              ...(message.id === undefined ? {} : { id: message.id }),
            })
          } else if (message.id !== undefined) {
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
        onSuccess: () => fail(new AgentError('Codex stream ended')),
      }),
      Effect.forkScoped
    )
    const connection: CodexConnection = {
      messages,
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
    yield* connection.request('initialize', {
      clientInfo: { name: 'jetty', title: 'Jetty', version: '2.0.0' },
      capabilities: { experimentalApi: true },
    })
    yield* send({ method: 'initialized' })
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

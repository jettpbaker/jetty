import type { ThreadEvent } from '@jetty/shared/events'

import { Deferred, Effect, Fiber, Queue, Schema, Scope, Semaphore, Stream } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

import type { Store } from './store'

import { AgentError, type Emit, type TurnInput } from './agent'

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
export type StdioProcessOptions = { command?: string; args?: string[]; requestTimeoutMs?: number }

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
    // Drained, never logged: provider diagnostics may contain prompts.
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
            // Detached responses share the message queue so earlier deltas publish first.
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

export function toAgentError(error: Error) {
  return error instanceof AgentError ? error : new AgentError(error.message)
}

export type StdioPending = { id: RpcId; questions?: unknown[] }
export type StdioSession<P extends StdioPending = StdioPending> = {
  input: TurnInput
  emit: Emit
  translator: { finish(): ThreadEvent[] }
  connection?: StdioConnection
  providerThreadId?: string
  accepting: boolean
  settled: boolean
  reason: string | null
  pending: Map<string, P>
  publication: Semaphore.Semaphore
  fiber?: Fiber.Fiber<void, AgentError>
}

export function createStdioTurns<P extends StdioPending, S extends StdioSession<P>>(store: Store) {
  return Effect.gen(function* () {
    const owner = yield* Effect.scope
    const sessions = new Map<string, S>()
    const admission = yield* Semaphore.make(1)

    function settleOpenItems(session: S) {
      return Effect.gen(function* () {
        for (const [itemId, pending] of session.pending) {
          yield* session.emit({
            type: 'item.completed',
            itemId,
            patch: pending.questions
              ? { skipped: true }
              : { decision: 'deny', deniedReason: session.reason ?? 'Turn ended' },
          })
        }
        session.pending.clear()
        for (const event of session.translator.finish()) yield* session.emit(event)
      })
    }

    function stopOnFailure(session: S, reason: string) {
      return Effect.gen(function* () {
        session.reason = reason
        session.accepting = false
        if (session.fiber) yield* Fiber.interrupt(session.fiber)
      })
    }

    function withSession(
      threadId: string,
      body: (session: S) => Effect.Effect<boolean, AgentError>
    ) {
      return Effect.suspend(() => {
        const session = sessions.get(threadId)
        if (!session) return Effect.succeed(false)
        return session.publication.withPermit(body(session)).pipe(
          Effect.uninterruptible,
          Effect.onError((cause) => stopOnFailure(session, String(cause)))
        )
      })
    }

    function startTurn(
      input: TurnInput,
      emit: Emit,
      create: (base: Omit<StdioSession<P>, 'translator'>) => S,
      run: (session: S, cwd: string) => Effect.Effect<ThreadEvent, Error, Scope.Scope>
    ) {
      return Effect.gen(function* () {
        if (sessions.has(input.threadId))
          return yield* Effect.fail(new AgentError('Turn already active'))
        const thread = yield* store.getThread(input.threadId)
        const project = thread && (yield* store.getProject(thread.projectId))
        if (!project) return yield* Effect.fail(new AgentError('Thread project not found'))
        const done = yield* Deferred.make<void, AgentError>()
        const session = create({
          input,
          emit,
          accepting: false,
          settled: false,
          reason: null,
          pending: new Map(),
          publication: yield* Semaphore.make(1),
        })
        sessions.set(input.threadId, session)
        const lifecycle = Effect.scoped(run(session, project.path)).pipe(
          Effect.flatMap((terminal) =>
            session.publication.withPermit(
              session.emit(
                terminal,
                Effect.sync(() => {
                  session.settled = true
                  if (sessions.get(input.threadId) === session) sessions.delete(input.threadId)
                })
              )
            )
          ),
          Effect.mapError(toAgentError),
          Effect.onInterrupt(() =>
            session.publication
              .withPermit(
                Effect.gen(function* () {
                  session.accepting = false
                  if (session.settled) return
                  yield* settleOpenItems(session).pipe(Effect.ignore)
                  yield* emit({
                    type: 'turn.failed',
                    turnId: input.turnId,
                    error: session.reason ?? 'server shutdown',
                  })
                })
              )
              .pipe(Effect.ignore)
          ),
          Effect.onError(() =>
            session.publication
              .withPermit(
                Effect.gen(function* () {
                  session.accepting = false
                  yield* settleOpenItems(session)
                })
              )
              .pipe(Effect.ignore)
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (sessions.get(input.threadId) === session) sessions.delete(input.threadId)
            })
          ),
          Effect.onExit((exit) => Deferred.done(done, exit))
        )
        session.fiber = yield* Effect.forkIn(lifecycle, owner)
        return { await: Deferred.await(done) }
      }).pipe(Effect.mapError(toAgentError), admission.withPermit)
    }

    function interrupt(
      threadId: string,
      reason: string,
      timeout: number,
      cancel: (session: S) => Effect.Effect<unknown, AgentError>
    ) {
      return Effect.gen(function* () {
        const session = sessions.get(threadId)
        if (!session) return
        yield* session.publication.withPermit(
          Effect.sync(() => {
            session.reason = reason
            session.accepting = false
          })
        )
        yield* cancel(session).pipe(Effect.timeout(timeout), Effect.ignore)
        if (session.fiber) yield* Fiber.interrupt(session.fiber)
      })
    }

    function respond(
      threadId: string,
      itemId: string,
      result: (pending: P, session: S) => unknown,
      patch: Record<string, unknown>
    ) {
      return withSession(threadId, (session) =>
        Effect.gen(function* () {
          const pending = session.pending.get(itemId)
          if (!session.accepting || !pending || !session.connection) return false
          const response = result(pending, session)
          if (!response) return false
          yield* session.emit(
            { type: 'item.completed', itemId, patch },
            Effect.sync(() => {
              session.pending.delete(itemId)
            })
          )
          yield* session.connection.respond(pending.id, response)
          yield* session.emit({
            type: 'session.status',
            status: session.pending.size ? 'awaiting_approval' : 'running',
          })
          return true
        })
      )
    }

    return { sessions, settleOpenItems, stopOnFailure, withSession, startTurn, interrupt, respond }
  })
}

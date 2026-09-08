import type { ChromePushData, ParamsOf, ResultOf } from '@jetty/shared/wire'

import { JettyRpcs, type ThreadUpdate } from '@jetty/shared/rpc'
import { Cause, Effect, Exit, Fiber, Layer, Scope, Stream } from 'effect'
import { RpcClient, type RpcGroup, RpcSerialization } from 'effect/unstable/rpc'
import { Socket } from 'effect/unstable/socket'

type UnaryMethod = Exclude<
  RpcGroup.Rpcs<typeof JettyRpcs>['_tag'],
  'chrome.subscribe' | 'thread.subscribe'
>
export type ThreadMessage = ThreadUpdate & { threadId: string }
export type TestMessage = ThreadMessage | ChromePushData
type Snapshot = Extract<ThreadUpdate, { type: 'snapshot' }>
type Ready = Extract<ThreadUpdate, { type: 'ready' }>

function collect<A>() {
  const messages: A[] = []
  const waiters = new Set<{
    predicate: (message: A) => boolean
    resolve: (message: A) => void
    reject: (error: unknown) => void
  }>()
  let failure: { error: unknown } | undefined

  function waitFor(predicate: (message: A) => boolean, ms = 5000): Promise<A> {
    const found = messages.find(predicate)
    if (found !== undefined) return Promise.resolve(found)
    if (failure) return Promise.reject(failure.error)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter)
        reject(new Error('waitFor timed out'))
      }, ms)
      const waiter = {
        predicate,
        resolve(message: A) {
          clearTimeout(timer)
          waiters.delete(waiter)
          resolve(message)
        },
        reject(error: unknown) {
          clearTimeout(timer)
          waiters.delete(waiter)
          reject(error)
        },
      }
      waiters.add(waiter)
    })
  }

  function publish(message: A) {
    messages.push(message)
    for (const waiter of waiters) {
      if (waiter.predicate(message)) waiter.resolve(message)
    }
  }

  function fail(error: unknown) {
    failure = { error }
    for (const waiter of waiters) waiter.reject(error)
  }

  return { messages, waitFor, publish, fail }
}

export type Subscription<A, Initial extends A = A> = {
  messages: A[]
  ready: Promise<Initial>
  waitFor: (predicate: (message: A) => boolean, ms?: number) => Promise<A>
  cancel: () => Promise<void>
  done: Promise<Exit.Exit<void, unknown>>
}

export async function connect(port: number) {
  const scope = Scope.makeUnsafe()
  const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(
      Socket.layerWebSocket(`ws://127.0.0.1:${port}/ws`).pipe(
        Layer.provide(Socket.layerWebSocketConstructorGlobal)
      )
    )
  )
  const services = await Effect.runPromise(Layer.buildWithScope(protocol, scope))
  const rpc = await Effect.runPromise(
    RpcClient.make(JettyRpcs, { flatten: true }).pipe(
      Effect.provideContext(services),
      Effect.provideService(Scope.Scope, scope)
    )
  )
  const received = collect<TestMessage>()

  function subscribe<A, Initial extends A>(
    stream: Stream.Stream<A, unknown>,
    isInitial: (message: A) => message is Initial,
    publish: (message: A) => void
  ): Subscription<A, Initial> {
    const collected = collect<A>()
    const ready = collected.waitFor(isInitial).then((message) => message as Initial)
    void ready.catch(() => undefined)
    const fiber = Effect.runFork(
      Stream.runForEach(stream, (message) =>
        Effect.sync(() => {
          collected.publish(message)
          publish(message)
        })
      ).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            collected.fail(
              Exit.isFailure(exit) ? Cause.squash(exit.cause) : new Error('Stream ended')
            )
          })
        )
      )
    )
    Effect.runSync(Scope.addFinalizer(scope, Fiber.interrupt(fiber)))
    return {
      messages: collected.messages,
      waitFor: collected.waitFor,
      ready,
      cancel: () => Effect.runPromise(Fiber.interrupt(fiber)),
      done: Effect.runPromise(Fiber.await(fiber)),
    }
  }

  function subscribeThread(params: {
    threadId: string
    afterSeq?: undefined
  }): Subscription<ThreadUpdate, Snapshot>
  function subscribeThread(params: {
    threadId: string
    afterSeq: number
  }): Subscription<ThreadUpdate, Ready>
  function subscribeThread(
    params: ParamsOf<'thread.subscribe'>
  ): Subscription<ThreadUpdate, Snapshot | Ready>
  function subscribeThread(params: ParamsOf<'thread.subscribe'>) {
    return subscribe(
      rpc('thread.subscribe', params),
      (message): message is Snapshot | Ready =>
        message.type === (params.afterSeq === undefined ? 'snapshot' : 'ready'),
      (message) => received.publish({ ...message, threadId: params.threadId })
    )
  }

  function subscribeChrome() {
    return subscribe(
      rpc('chrome.subscribe', {}),
      (message): message is Extract<ChromePushData, { type: 'snapshot' }> =>
        message.type === 'snapshot',
      received.publish
    )
  }

  async function request<M extends UnaryMethod>(
    method: M,
    params: ParamsOf<M>
  ): Promise<ResultOf<M>> {
    const unary = rpc as unknown as <M extends UnaryMethod>(
      method: M,
      params: ParamsOf<M>
    ) => Effect.Effect<ResultOf<M>, unknown>
    return Effect.runPromise(unary(method, params))
  }

  async function close() {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    received.fail(new Error('Client closed'))
  }

  return {
    rpc,
    request,
    subscribeThread,
    subscribeChrome,
    messages: received.messages,
    waitFor: received.waitFor,
    close,
  }
}

export type Client = Awaited<ReturnType<typeof connect>>

export function isThreadEvent(
  message: TestMessage
): message is Extract<ThreadMessage, { type: 'event' }> {
  return message.type === 'event'
}

export function isChromeUpdate(message: TestMessage): message is ChromePushData {
  return (
    message.type !== 'event' &&
    message.type !== 'ready' &&
    (message.type !== 'snapshot' || 'projects' in message)
  )
}

export function threadEvents(client: Client, threadId: string) {
  return client.messages.filter(
    (message): message is Extract<ThreadMessage, { type: 'event' }> =>
      isThreadEvent(message) && message.threadId === threadId
  )
}

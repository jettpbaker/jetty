import type { PullRequestListTab } from '@jetty/shared/wire'

import { JettyRpcs } from '@jetty/shared/rpc'
import { Effect, Latch, Layer, Schedule, Stream } from 'effect'
import { RpcClient, RpcClientError, type RpcGroup, RpcSerialization } from 'effect/unstable/rpc'
import { Socket } from 'effect/unstable/socket'

type UnaryRpcs = Exclude<
  RpcGroup.Rpcs<typeof JettyRpcs>,
  {
    readonly _tag:
      | 'chrome.subscribe'
      | 'thread.subscribe'
      | 'pullRequest.subscribe'
      | 'pullRequestList.subscribe'
  }
>

const backoff = Schedule.min([
  Schedule.exponential('500 millis', 1.5),
  Schedule.spaced('5 seconds'),
])

const reconnect = backoff.pipe(
  Schedule.while(({ input }) => input instanceof RpcClientError.RpcClientError)
)

function protocol(
  url: Effect.Effect<string>,
  hooks: RpcClient.ConnectionHooks['Service'],
  retryPolicy: Schedule.Schedule<unknown>
) {
  const socket = Socket.layerWebSocket(url).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal)
  )
  return Layer.effect(RpcClient.Protocol)(
    RpcClient.makeProtocolSocket({ retryTransientErrors: true, retryPolicy })
  ).pipe(
    Layer.provide([
      socket,
      RpcSerialization.layerJson,
      Layer.succeed(RpcClient.ConnectionHooks, hooks),
    ])
  )
}

export function createConnection(
  url: (reconnecting: boolean) => Promise<string>,
  onStatus: (connected: boolean) => void
) {
  return Effect.gen(function* () {
    const connected = Latch.makeUnsafe(false)
    let attempts = 0
    let failures = 0
    // The socket never resets its retry schedule, so each connect restarts the backoff here:
    // a server restarting on every save is back within a beat each time.
    const retryPolicy = Schedule.forever.pipe(
      Schedule.modifyDelay(() => Effect.succeed(Math.min(5000, 250 * 2 ** failures++)))
    )
    const services = yield* Layer.build(
      protocol(
        Effect.promise(() => url(attempts++ > 0)),
        {
          onConnect: Effect.sync(() => {
            failures = 0
            connected.openUnsafe()
            onStatus(true)
          }),
          onDisconnect: Effect.sync(() => {
            connected.closeUnsafe()
            onStatus(false)
          }),
        },
        retryPolicy
      )
    )
    const rpc = yield* RpcClient.make(JettyRpcs, { flatten: true }).pipe(
      Effect.provideContext(services)
    )
    const unary: RpcClient.RpcClient.Flat<UnaryRpcs, RpcClientError.RpcClientError> = rpc
    // Work started while disconnected waits for the reconnect rather than failing.
    const request = ((...args: Parameters<typeof unary>) =>
      connected.whenOpen(unary(...args))) as typeof unary

    function online<A, E>(stream: Stream.Stream<A, E>) {
      return Stream.unwrap(Effect.as(connected.await, stream))
    }

    function subscribeChrome() {
      return online(rpc('chrome.subscribe', {})).pipe(Stream.retry(reconnect))
    }

    function subscribeThread(threadId: string, afterSeq?: number) {
      let seq = afterSeq
      return online(
        Stream.suspend(() => rpc('thread.subscribe', { threadId, afterSeq: seq }))
      ).pipe(
        Stream.tap((update) =>
          Effect.sync(() => {
            seq = update.seq
          })
        ),
        Stream.retry(reconnect)
      )
    }

    function subscribePullRequest(repo: string, number: number) {
      return online(rpc('pullRequest.subscribe', { repo, number })).pipe(Stream.retry(reconnect))
    }

    function subscribePullRequestList(tab: PullRequestListTab) {
      return online(rpc('pullRequestList.subscribe', { tab })).pipe(Stream.retry(reconnect))
    }

    return {
      request,
      subscribeChrome,
      subscribeThread,
      subscribePullRequest,
      subscribePullRequestList,
    }
  })
}

export type Connection = Effect.Success<ReturnType<typeof createConnection>>

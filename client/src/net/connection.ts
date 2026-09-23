import { JettyRpcs } from '@jetty/shared/rpc'
import { Effect, Layer, Schedule, Stream } from 'effect'
import { RpcClient, RpcClientError, type RpcGroup, RpcSerialization } from 'effect/unstable/rpc'
import { Socket } from 'effect/unstable/socket'

type UnaryRpcs = Exclude<
  RpcGroup.Rpcs<typeof JettyRpcs>,
  { readonly _tag: 'chrome.subscribe' | 'thread.subscribe' | 'pullRequest.subscribe' }
>

const backoff = Schedule.min([
  Schedule.exponential('500 millis', 1.5),
  Schedule.spaced('5 seconds'),
])

const reconnect = backoff.pipe(
  Schedule.while(({ input }) => input instanceof RpcClientError.RpcClientError)
)

function protocol(url: string) {
  const socket = Socket.layerWebSocket(url).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal)
  )
  return Layer.effect(RpcClient.Protocol)(
    RpcClient.makeProtocolSocket({ retryTransientErrors: true, retryPolicy: backoff })
  ).pipe(Layer.provide([socket, RpcSerialization.layerJson]))
}

export function createConnection(url: string) {
  return Effect.gen(function* () {
    const services = yield* Layer.build(protocol(url))
    const rpc = yield* RpcClient.make(JettyRpcs, { flatten: true }).pipe(
      Effect.provideContext(services)
    )
    const request: RpcClient.RpcClient.Flat<UnaryRpcs, RpcClientError.RpcClientError> = rpc

    function subscribeChrome() {
      return rpc('chrome.subscribe', {}).pipe(Stream.retry(reconnect))
    }

    function subscribeThread(threadId: string, afterSeq?: number) {
      let seq = afterSeq
      return Stream.suspend(() => rpc('thread.subscribe', { threadId, afterSeq: seq })).pipe(
        Stream.tap((update) =>
          Effect.sync(() => {
            seq = update.seq
          })
        ),
        Stream.retry(reconnect)
      )
    }

    function subscribePullRequest(repo: string, number: number) {
      return rpc('pullRequest.subscribe', { repo, number }).pipe(Stream.retry(reconnect))
    }

    return { request, subscribeChrome, subscribeThread, subscribePullRequest }
  })
}

export type Connection = Effect.Success<ReturnType<typeof createConnection>>

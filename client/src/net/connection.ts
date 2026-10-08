import type { GitHubActivity } from '@jetty/shared/pull-request'
import type { PullRequestListTab } from '@jetty/shared/wire'

import { perf } from '@/perf'
import { JettyRpcs } from '@jetty/shared/rpc'
import { Effect, Latch, Layer, Schedule, Stream } from 'effect'
import { RpcClient, RpcClientError, type RpcGroup, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'

type UnaryRpcs = Exclude<
  RpcGroup.Rpcs<typeof JettyRpcs>,
  {
    readonly _tag:
      | 'chrome.subscribe'
      | 'github.activity'
      | 'bot.presence'
      | 'thread.subscribe'
      | 'pullRequest.subscribe'
      | 'pullRequestList.subscribe'
  }
>

const backoff = Schedule.min([
  Schedule.exponential('500 millis', 1.5),
  Schedule.spaced('5 seconds'),
])

// A subscription the server ended for falling behind picks up where it got to, as after a drop.
const reconnect = backoff.pipe(
  Schedule.while(
    ({ input }) =>
      input instanceof RpcClientError.RpcClientError ||
      (typeof input === 'object' && input !== null && 'code' in input && input.code === 'lagged')
  )
)

// A call the server takes once however often it arrives (it knows the message or thread by id) is
// sent again after a dropped connection, instead of failing without knowing whether it landed.
// Tries wait for the connection to come back, so the cap only gives up on one that keeps failing.
export function resendOnDrop<A, E, R>(call: Effect.Effect<A, E, R>) {
  return call.pipe(
    Effect.retry({
      while: (error) => error instanceof RpcClientError.RpcClientError,
      schedule: Schedule.spaced('1 second'),
      times: 20,
    })
  )
}

function githubActivity(): GitHubActivity {
  return document.visibilityState === 'hidden'
    ? 'hidden'
    : document.hasFocus()
      ? 'focused'
      : 'blurred'
}

function activityStream() {
  const changes = Stream.mergeAll(
    [
      Stream.fromEventListener(document, 'visibilitychange'),
      Stream.fromEventListener(window, 'focus'),
      Stream.fromEventListener(window, 'blur'),
    ],
    { concurrency: 'unbounded' }
  ).pipe(Stream.map(githubActivity))
  return Stream.suspend(() =>
    Stream.concat(Stream.succeed(githubActivity()), changes).pipe(Stream.changes)
  )
}

function protocol(
  url: Effect.Effect<string>,
  hooks: RpcClient.ConnectionHooks['Service'],
  retryPolicy: Schedule.Schedule<unknown>
) {
  const socket = Socket.layerWebSocket(url).pipe(
    Layer.provide(
      Layer.succeed(Socket.WebSocketConstructor)((url, options) =>
        perf.watchSocket(
          new globalThis.WebSocket(
            url,
            typeof options === 'object' && !Array.isArray(options) ? undefined : options
          )
        )
      )
    )
  )
  return Layer.effect(RpcClient.Protocol)(RpcClient.makeProtocolSocket({ retryPolicy })).pipe(
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
      connected.whenOpen<unknown, unknown, never>(unary(...args))) as typeof unary

    function online<A, E>(stream: Stream.Stream<A, E>) {
      return Stream.unwrap(Effect.as(connected.await, stream))
    }

    // The window's attention rides a stream of its own, so a focus change resubscribes nothing else.
    yield* activityStream().pipe(
      Stream.switchMap((activity) => online(rpc('github.activity', { activity }))),
      Stream.retry(reconnect),
      Stream.runDrain,
      Effect.forkScoped
    )

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

    // Says this window shows the bot's chat, for as long as the stream stays open.
    function watchBotPresence(botId: string, draft: boolean) {
      return online(rpc('bot.presence', { botId, draft })).pipe(Stream.retry(reconnect))
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
      watchBotPresence,
      subscribePullRequest,
      subscribePullRequestList,
    }
  })
}

export type Connection = Effect.Success<ReturnType<typeof createConnection>>

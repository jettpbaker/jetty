# jetty-v2: Effect backend port

Status: proposal for Jett, not approved for implementation. This is the backend
track of v2; the replacement frontend, new features/design, and possible Electron
shell need their own design decisions. Each chunk below stops for a walkthrough
before the next starts.

## version check — 2026-09-08

The npm registry reports:

| Package                  | `latest` (stable/v3-compatible) | `rc` (v4)      |
| ------------------------ | ------------------------------- | -------------- |
| `effect`                 | `3.22.1`                        | `4.0.0-rc.112` |
| `@effect/platform-bun`   | `0.91.2`                        | `4.0.0-rc.112` |
| `@effect/sql-sqlite-bun` | `0.53.0`                        | `4.0.0-rc.112` |

Root `package.json` already declares `effect: ^4.0.0-rc.112`; `bun.lock` and
the installed package both resolve to `4.0.0-rc.112`. No upgrade is needed.
The current work deliberately uses v4, not npm's stable `latest` tag. Recommend
continuing v4 RC and exact-pinning the three packages when each is introduced,
updating them together deliberately rather than mixing v3 integrations with v4.
Recheck registry tags before building: this is a dated check, not a floating promise.

Sources: [Effect registry](https://registry.npmjs.org/effect),
[Bun platform registry](https://registry.npmjs.org/@effect%2fplatform-bun),
[Bun SQLite registry](https://registry.npmjs.org/@effect%2fsql-sqlite-bun), and
[upstream README](https://github.com/Effect-TS/effect). The installed RC source
and the published integration tarballs were checked for the APIs named below;
use version-matched v4 docs rather than v3 tutorials. The repo has Bun `1.3.14`,
TypeScript `7.0.2`, and strict type-checking enabled. Integration-package runtime
compatibility still needs the first chunk's smoke tests; they are not installed yet.

## starting point

Commit `84b6a2d` began the port. `server/src/orchestrator.ts` implements
`startTurnEffect` with `Effect.gen`, logging, failure handling, and a detached
agent-lifecycle fiber. `server/src/ws.ts` runs it with `Effect.runPromise`.
Those are the only server/shared source files importing Effect today.

The rest is still synchronous functions, promises, callbacks, and manual cleanup:

- `main.ts` constructs the graph, serves HTTP/WS, reconciles interrupted threads,
  and handles process signals. `stop()` stops Bun and closes SQLite; the CLI's
  signal handler separately asks agents to interrupt without awaiting completion.
- `db.ts` / `store.ts` own SQLite, SQL statements, an atomic event/projection
  transaction, CRUD, and Claude resume pointers.
- `orchestrator.ts` owns append-then-publish, turn admission/steering, and a
  fire-and-forget titler. `ws.ts` / `hub.ts` own dispatch, subscriptions, and replay.
- `claude.ts` owns warm queries, a hand-built async input queue, approval/question
  resolvers, turn waiters, idle expiry, and a two-second interrupt fallback.
  `context-usage.ts` and `usage.ts` handle SDK control requests.
- Attachments, image/video MCP tools, filesystem browse/search, skills, git diffs,
  and static/range serving are additional backend paths, not migration leftovers.
- `shared/` defines Zod contracts and the common reducer; the current browser uses
  those schemas for socket decoding and persisted-cache validation.

Baseline: `JETTY_AGENT=echo bun test server shared` passes 119 tests with one
live-Claude test skipped; `bun run typecheck` and
`bun run lint -- server/src shared/src` pass. The baseline does not prove live SDK
session lifecycle behavior, and there are no dedicated warm-session adapter tests.

## proposed scope and architecture

Port the existing backend's effects, not its product semantics. Keep Bun, the
SQLite file/schema, the event ledger, and the Claude Code SDK. Effect's Anthropic
provider is not a replacement for Claude Code's agent/session machinery.
Keep pure transformations such as `applyEvent`, SDK event translation, fuzzy
ranking, and diff truncation as ordinary TypeScript.

Use factory-built service values, `type` declarations, `Context.Service` keys,
and `Layer` composition. No service classes, generic repository framework, or
one-service-per-helper split. Names below describe responsibilities and are
proposals, not settled APIs:

- A store service owns persistence and resume pointers, backed eventually by
  `@effect/sql-sqlite-bun` (still `bun:sqlite`, not a database replacement).
- Agent and optional titler services keep provider-specific types at the edge;
  echo and Claude provide the same application-facing agent contract.
- An orchestrator owns turn admission, durable event publication, and terminal
  outcomes. Agent callbacks/streams, SDK tools, and context updates all use that
  single event path.
- A transport/hub layer owns sockets and subscriptions. Workspace/media services
  group filesystem, subprocess, and attachment capabilities where consumed.
- `main.ts` becomes the composition root: config, live layers, reconciliation,
  listening, and `BunRuntime.runMain`. Promise runners remain only at genuinely
  foreign boundaries (Bun callbacks during transition, SDK callbacks, and tests).

The server has one owning scope. Request/connection scopes are children, but
accepted turns and warm sessions are server-owned: completing a request or
disconnecting a browser must not stop work. A warm session spans multiple turns;
its reader, input queue, polling, approval waiters, and expiry belong to its scope.
Turn completion does not close a healthy warm session.

Typed errors distinguish expected validation/not-found/provider/filesystem/store
failures from defects and interruption. Map them to the existing wire codes at
the transport boundary before leaving Effect; do not rely on a rejected runner
promise preserving the original error's `instanceof`. Unexpected causes are
logged with request/thread/turn identifiers, not prompts, credentials, or payloads.
Do not automatically retry turns, user messages, or event appends.

## invariants that must survive yielding

Effect scheduling introduces interleaving where the current synchronous code has
none. Make these guarantees explicit rather than relying on execution speed:

- Per-thread admission serializes deciding to steer versus creating a turn and
  recording its user message. Release that gate before waiting for the agent;
  interrupt and approval commands must remain usable during a turn.
- Event append, projection update, sequence allocation, and status changes remain
  one SQLite transaction. Publish only committed events, in per-thread sequence
  order; a failed socket send must not roll back a committed event.
- Subscription replay and the handoff to live delivery have no gap or
  out-of-order interleaving. Coordinate that handoff with per-thread publication;
  preserve the equivalent chrome snapshot/live handoff. Never hold a database
  transaction open while waiting for a socket or the SDK.
- Exactly one terminal outcome settles an active turn, including SDK error,
  explicit interrupt, forced close, and shutdown. Late emissions from an old
  session cannot affect its replacement.
- Shutdown stops admitting work, interrupts/joins owned tasks, settles SDK
  waiters and closes queries, finishes permitted terminal writes, then closes
  storage. Partial startup failures also release already-acquired resources.
- Streaming cannot acquire unbounded memory queues or silently drop timeline
  deltas. Recommended slow-client policy: bound each outbound queue and disconnect
  on overflow so the existing sequence-based reconnect catches up from SQLite.
  Confirm this policy before implementation; do not block every client on one peer.

## proposed chunks

### 1. runtime, services, and one complete vertical slice

Start with `main.ts`, `orchestrator.ts`, `agent.ts`, `ws.ts`, and the package
manifests. Add the matching Bun platform package, put the existing DB and Bun
listener under scoped acquisition/release, and read configuration in the runtime
rather than scattered module globals. Existing factory adapters can temporarily
provide layers while their internals are migrated.

Complete create-thread → echo turn → persisted event → socket push under the
shared runtime, including typed error-to-wire mapping and server-owned turn
fibers instead of `forkDetach`. Keep the current Bun socket bridge initially.
Test startup rollback, repeatable start/stop, missing-thread/invalid-attachment
wire errors, and a turn surviving request completion/browser disconnect.
Record echo request-acknowledgement and streaming latency before changing the
execution model, for the final parity comparison.
Walkthrough: service requirements, layers, and the owning scope.

### 2. orchestration, ordering, and ancillary work

Finish Effect-native orchestrator methods, short per-thread admission gates, and
the serialized commit/publication path. Put title generation under server ownership
with cancellation and its existing best-effort semantics; it must never delay a
turn or overwrite a title changed while generation was running. Establish an
awaitable event-emission bridge for the existing SDK adapter before store methods
become asynchronous, so callers cannot race ahead of persistence.

Exercise simultaneous starts, steering, start-versus-interrupt, exactly-once
terminal outcomes, publication failure after commit, and independence across
threads. Establish and test replay/live coordination now, before yielding store
operations or socket I/O replace the synchronous paths. Walkthrough: what runs
concurrently and what cannot.

### 3. persistence and workspace/media I/O

Port `db.ts` / `store.ts` to the matching Bun SQLite Effect client without changing
tables or JSON shapes. Preserve WAL, foreign keys, prepared/query behavior,
idempotent creation, resume pointers, startup reconciliation, and append atomicity.
Then port attachments, filesystem browse/search, skills loading, and git commands
to Effect filesystem/process operations. Keep pure parsing/ranking helpers plain.

Make subprocesses interruptible with exit-status handling, and attachment copying
rollback-safe on failure/interruption. Route image/video tool effects through the
SDK boundary without changing their tool contracts. Preserve existing empty-result
fallbacks and media limits. Test against a copy of a pre-port DB, transaction
rollback and concurrent appends, interrupted I/O cleanup, and media range responses.
Walkthrough: typed failures, transactions, and resource finalizers.

### 4. Claude and echo session lifecycles

Convert `claude.ts` and the echo adapter to the Effect agent contract. Use an
Effect queue for streaming input, deferred values for approval/question/turn
waiters, and scoped fibers for the SDK reader, idle expiry, and interrupt grace
period. Bridge the SDK's AsyncIterable and Promise callbacks at the adapter edge;
fiber interruption must explicitly interrupt/close SDK work, not merely abandon
the Promise. Avoid creating a runtime per message or callback.

Keep warm reuse, resume pointers, option-change recycling, mid-turn steering,
approval decisions, questions, media tools, and context/account-usage refreshes.
Scope the current module-global usage single-flight state to the running service.
An SDK query factory seam enables fake-query tests without Claude auth. Test late
results, abrupt stream exit, close during approval/question, expiry versus reuse,
interrupt fallback, and no post-close polling/publication. Use Effect's test clock
under Bun tests for time-dependent cases. Keep translator tests unchanged.
Walkthrough: session lifetime versus turn lifetime and SDK cancellation limits.

### 5. HTTP/WS and shared schema boundary

Move serving to `BunHttpServer` and Effect's HTTP/socket APIs while retaining the
existing JSON request/response/push envelopes and method catalog. Preserve origin
checks, loopback binding, static fallback, attachment path validation, HTTP Range,
fan-out, reconnect, and unsubscribe cleanup. Implement the agreed bounded
slow-client policy and prove replay/snapshot handoffs under concurrent events.

If approved, replace first-party Zod schemas with Effect Schema in `shared/` as
one coordinated contract change. Match optional/default/unknown-key behavior and
existing serialized event/state formats using fixtures. Update only the current
client's socket/cache decoder call sites and schema compositions; no UI redesign.
Retain narrow Zod definitions where the Claude SDK MCP tool API requires them.
Do not maintain two independently authored domain schema catalogs.

Effect RPC is a separate API decision, not a prerequisite for an Effect backend.
Recommend retaining the wire protocol for this port, then evaluating RPC against
the new frontend's needs. Walkthrough: decode → handler → encode and replay order.

### 6. parity, cleanup, and v2 handoff

Remove temporary promise/factory bridges and obsolete helpers once consumers are
ported. Verify no backend-owned detached work remains, and that runners live only
at explicit boundaries. Re-run backend/shared tests, full typecheck, relevant
lint, and the client build after schema changes. Manually exercise the existing
browser with echo: send/steer/interrupt, reconnect, cached reload, and media.
Compare request acknowledgement and streaming latency with the pre-port baseline.

With Jett's authenticated environment and permission to spend tokens, separately
smoke-test live Claude warm reuse, resume after restart, approvals/questions,
interrupt, and SDK media tools. Echo/fake tests do not substitute for that gate.
Update README architecture and this chunk index after acceptance.

The result is a backend usable by the current and future frontends. Electron
remains undecided: keeping Bun suggests an independently launched backend process
if a desktop shell is chosen, not importing Bun-only APIs into Electron's Node
main process. Local versus SSH-remote execution, backend packaging, authentication,
and desktop lifecycle need their own design before any Electron implementation.

## decisions to confirm before building

1. Continue v4 RC, exact-pin matching package versions, and accept the RC upgrade
   maintenance cost rather than porting to stable v3 first?
2. Preserve the current wire/data formats through the backend port (recommended),
   or coordinate a breaking protocol redesign with the new frontend now?
3. Target Effect's Bun HTTP/SQLite integrations and Effect Schema, allowing a small
   current-client decoder migration and SDK-required Zod at the boundary?
4. Accept bounded slow-client queues with disconnect/replay on overflow?

No runtime code, dependencies, or lockfile were changed while drafting this plan.

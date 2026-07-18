# chunk 6 — local persistence

Reloads stop starting from zero. The stores' caches get persisted to IndexedDB
and hydrated before first render, so a hard refresh paints the sidebar and the
open thread instantly from local data — then the socket connects and heals
whatever is stale. Linear-style. No server changes at all.

## the invariant that makes this safe

Persisted state can only be _stale_, never _wrong_ — because both stores
already self-heal:

- **chrome**: on connect the server pushes a full `snapshot` that wholesale
  replaces local state. Hydrated chrome is at most a few seconds behind and
  lives only until that push lands.
- **timeline**: every `ThreadState` carries `lastSeq`. A hydrated thread makes
  `openThread` take the warm path — `thread.subscribe { afterSeq }` — and the
  server replays only what's missing. The existing `snapshot.lastSeq >
current.lastSeq` guard already rejects stale data racing fresh data.

So hydration needs no coordination with the socket; guards we already have make
any ordering correct.

## the shape

- `client/src/state/persist.ts` — the only new file of substance. Owns the
  IndexedDB access (via `idb-keyval`), zod-validates on read, debounces writes.
  Keys: `chrome` (the whole ChromeState) and `thread:<id>` (one ThreadState
  each). IDB stores structured clones — no JSON stringify/parse.
- **read path**: `hydrate()` loads everything, parses with the schemas that
  already exist in `shared/` (`Project`/`ThreadMeta` from wire, `ThreadState`
  from the reducer), and _discards anything that doesn't parse_ — a zod
  mismatch after a schema change just means that entry reloads cold. Validation
  is the versioning; no version numbers.
- **boot order**: `main.tsx` awaits `hydrate()` before `createRoot(...)`. IDB
  reads are single-digit milliseconds — blocking first paint on them is what
  buys the zero-flash reload (perf rule: this is _removing_ network from the
  critical path, not adding local work to it). Socket connects in parallel as
  today; guards make the race safe.
- **write path**: stores stay ignorant of IDB. Store factories take an optional
  `persist` callback — `createChromeStore(socket, persistChrome)` fires it with
  the new state in `setState`; `createTimelineStore(socket, persistThread)`
  fires it with `(threadId, state)` in `setThread`. `persist.ts` debounces
  per key (trailing ~300ms) so streaming bursts cost one write, and flushes on
  `pagehide`.
- **not persisted**: `pendingSends` (in-flight by definition — after a reload
  the timeline catch-up shows the truth) and drafts (already in localStorage).
- archived-thread and evicted-thread states persist like everything else;
  storage is not a concern at personal-tool scale.

## open taste questions for Jett

- **`idb-keyval`** (the tech choice): ~600 bytes, promise-based get/set/del
  over IndexedDB, by the idb maintainer — the standard answer. Alternative is
  hand-rolling ~40 lines of IDB promisification; educational but boilerplate.
  Recommend the library.
- **Block first render on `hydrate()`** (recommended, ms-scale, zero-flash) vs
  render-empty-then-fill (never blocks, but reload flashes empty chrome for a
  frame or two)?
- **Hydrate everything** at boot (recommended for now — dozens of threads is
  nothing) vs only recent-N threads? Easy knob to add later if boot reads ever
  show up in profiling.

## build order

One agent, one pass (opus — this is core client state architecture, no visual
work but the same cleanliness bar): persist.ts, the two store-factory hooks,
main.tsx boot change, plus a small test for the round-trip and the
discard-on-parse-failure path.

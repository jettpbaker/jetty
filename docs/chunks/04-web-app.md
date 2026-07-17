# chunk 4 — web app

The first chunk with pixels: a Vite React SPA served by the same Bun process, talking
to the server over the WebSocket contracts from chunk 1. Scope is "usable daily
driver for text-only turns": sidebar, streaming timeline, composer. Approvals UI,
permission mode picker (5), image paste (7), and diffs (8) stay in their own chunks —
the timeline renders those items read-only where they appear, nothing more.

## workspace layout

New `client/` workspace next to `server/` and `shared/`:

```
client/
  src/
    main.tsx            entry, router mount
    routes/             TanStack Router file routes
    socket.ts           the ws client (connect, request/response, subscriptions)
    state/              chrome store + per-thread timeline store
    components/         sidebar, timeline, item renderers, composer
  index.html
  vite.config.ts
```

Dev: Vite dev server on 5173 proxying `/ws` to the Bun server on 8787 — hot reload
for the client, real server behind it. Prod: `vite build` output served as static
files by Bun (already stubbed in main.ts). Same origin either way, so the client
just connects to `ws://<host>/ws`.

## socket client

One module owning a single WebSocket. Three jobs:

- **request/response**: `request(method, params)` returns a promise; each request
  carries an `id`, a pending map resolves the matching response. This is the mirror
  image of the server's dispatch table.
- **subscription fan-out**: pushes (`sub: 'chrome' | 'thread'`) are routed to
  whichever store subscribed. The socket client knows nothing about React.
- **reconnect**: on close, retry with backoff; on reopen, re-issue `chrome.subscribe`
  and `thread.subscribe { afterSeq: lastSeenSeq }` for the open thread. The server's
  snapshot + catch-up replay does the rest — this is where the chunk 1/2 design pays
  out, the client barely has recovery logic.

## state

No state library. Two small hand-rolled stores exposed to React via
`useSyncExternalStore`:

- **chrome store**: projects + thread rows, updated by `thread.upserted` /
  `project.upserted` pushes. One subscription for the whole app lifetime.
- **timeline store**: a `Map<threadId, ThreadState>` cache. Pushes for the open
  thread are applied with the _same_ `applyEvent` reducer from `shared/` — the
  moment the client imports it, the "reducer runs on both sides" claim from the
  README becomes literally true. The cache is never evicted on navigation: leaving
  a thread unsubscribes but keeps its state.

If hand-rolled starts hurting we can swap in zustand later; starting bare keeps the
data flow visible while the architecture is still being learned.

## performance

The #1 UX value (per AGENTS.md). Concretely for this chunk:

- **instant thread switch**: clicking a thread renders synchronously from the
  cached `ThreadState` (or an empty shell for a never-visited thread) — zero
  network on the critical path. Then `thread.subscribe { afterSeq: cached.lastSeq }`
  patches the gap in the background. Navigation fires on pointer-down (AGENTS.md).
- **last-N warm subscriptions**: the timeline store keeps the last N visited
  threads (N=5) subscribed, LRU-evicted with `thread.unsubscribe`. Recently
  visited threads stream into their caches in the background, so bouncing between
  hot threads renders _current_ state instantly — no catch-up gap at all. Open
  components don't re-render on background updates (their snapshots are untouched
  references). Reconnect re-subscribes every held thread with its own `afterSeq`.
- **one delta = one component render**: item renderers are wrapped in `React.memo`,
  and `applyEvent` already replaces only the touched item (`updateItem` copies the
  array, swaps one index) — untouched items keep their references, so a streaming
  delta re-renders exactly one message component.
- **virtualized timeline**: `react-virtuoso` from day one — only the visible window
  mounts, `followOutput` handles stick-to-bottom during streaming. Mounting a
  500-item thread must not cost the instant switch. This is the one place we skip
  an AI Elements component (`Conversation`, which renders the full list) for a perf
  reason.
- **stable refs on navigation**: TanStack Router's structural sharing keeps route
  context references stable so switching threads doesn't cascade re-renders through
  sidebar/composer.

## routes

- `/` — sidebar + empty state ("pick a thread")
- `/thread/$threadId` — sidebar + thread view
- `/settings` — empty placeholder page, route wired now so future settings have a home

Project is implicit (threads know their project); no project route needed yet.

## components

shadcn-first per AGENTS.md — shadcn/ui core + the AI Elements registry (both are
copy-into-repo registries, so the code lands in `client/src/components/` and is ours
to keep clean). The plan, piece by piece:

- **sidebar**: shadcn `Sidebar` family (`SidebarProvider`, `SidebarGroup` per
  project, `SidebarMenu`/`SidebarMenuButton` per thread, `SidebarMenuAction` for
  archive), `DropdownMenu` for thread actions, `Dialog` for new project. Status dot
  is a plain styled span (no component needed). Rows show title + status dot.
  Act-on-pointer-down for thread switching.
- **timeline**: `react-virtuoso` as the list container (see performance). Item
  renderers from AI Elements: `Message`/`MessageContent` for user + assistant,
  `Response` (streamdown) for markdown bodies, `Reasoning` (collapsed by default),
  `Tool` (`ToolHeader`/`ToolInput`/`ToolOutput`) for tool calls. Plan items render
  as `Response` in a bordered container; errors as shadcn `Alert` (destructive);
  approvals as a read-only `Card` + `Badge` until chunk 5 makes them interactive.
- **composer**: AI Elements `PromptInput` (`PromptInputTextarea`,
  `PromptInputSubmit` — its status prop covers the send→stop swap). Enter sends
  (`turn.start`), Shift+Enter newline; while a turn runs the same box steers and the
  submit button becomes stop (`turn.interrupt`).
- **settings**: empty page, shadcn primitives when it grows content.

All default shadcn styling per AGENTS.md; the design pass comes later.

## build order

Two handoffs, reviewed separately:

1. **plumbing** (grok): workspace scaffold (Vite, Tailwind, shadcn init, tooling
   hookup), `socket.ts`, both stores with the thread-state cache, route skeleton
   with unstyled proof-of-flow pages, tests against a real server running the echo
   agent.
2. **ui** (opus): the component plan above on top of the plumbing — memoized item
   renderers, virtuoso, pointer-down navigation, composer wiring.

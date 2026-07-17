# chunk 4 — web app

The first chunk with pixels: a Vite React SPA served by the same Bun process, talking
to the server over the WebSocket contracts from chunk 1. Scope is "usable daily
driver for text-only turns": sidebar, streaming timeline, composer. Approvals UI,
permission mode picker (5), image paste (6), and diffs (7) stay in their own chunks —
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
- **timeline store**: holds `ThreadState` for the open thread and applies pushes with
  the *same* `applyEvent` reducer from `shared/` — the moment the client imports it,
  the "reducer runs on both sides" claim from the README becomes literally true.
  Subscribe on thread open, unsubscribe on leave.

If hand-rolled starts hurting we can swap in zustand later; starting bare keeps the
data flow visible while the architecture is still being learned.

## routes

- `/` — sidebar + empty state ("pick a thread")
- `/thread/$threadId` — sidebar + thread view

Project is implicit (threads know their project); no project route needed yet.

## components

- **sidebar**: projects as groups, threads under each, status dot from
  `ThreadMeta.status` (running / awaiting approval / error / idle), new-thread and
  new-project actions, archive via context or hover action. Act-on-pointer-down for
  thread switching.
- **timeline**: renders `ThreadState.items` in order. One renderer per item kind:
  user/assistant messages (markdown), reasoning (collapsed by default), tool calls
  (name + collapsible input/output), approvals (read-only card until chunk 5), plan,
  error. Streaming text just re-renders as deltas apply.
- **composer**: textarea, Enter to send (`turn.start`), Shift+Enter newline. While a
  turn runs the same box sends steer messages — matching the terminal muscle memory —
  plus a stop button wired to `turn.interrupt`.
- **markdown**: assistant text through the streaming-friendly renderer from shadcn's
  agent components (streamdown) rather than react-markdown — built for
  partially-arrived markdown.

All default shadcn styling per AGENTS.md; the design pass comes later.

## open questions for Jett

- hand-rolled stores vs zustand from day one?
- streamdown for markdown ok, or a preference for react-markdown?
- route shape `/thread/$threadId` ok?
- anything you want visible in the sidebar row beyond title + status dot?

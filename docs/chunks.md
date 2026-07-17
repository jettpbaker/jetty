# chunks

The build plan, in order. This file is persistent — in-flight design notes live in
`docs/chunks/` and get deleted once a chunk is built and confirmed, but this index
stays and tracks status.

- [x] **1. contracts** — zod schemas in `shared/` for timeline items, thread events,
      the reducer, and the ws method catalog. The shared vocabulary both sides
      import; nothing outside `shared/` gets to invent a shape.
- [x] **2. server skeleton** — Bun.serve with ws dispatch over the method table,
      sqlite persistence (event log + projections + chrome tables), and a fake echo
      agent proving turn → events → push end to end before Claude enters the picture.
- [x] **3. claude adapter** — claude-agent-sdk sessions mapped to normalized events;
      resume across restarts, interrupt, `canUseTool` surfaced as approval items.
- [ ] **4. web app** — Vite React SPA: project/thread sidebar over `chrome.subscribe`,
      thread view with streaming timeline, composer. Default shadcn styling.
- [ ] **5. approvals + permission modes** — approval cards wired to `approval.respond`,
      permission mode picker per thread. Three surfaced modes: auto (default),
      full access, plan. PermissionMode on the wire is jetty vocabulary
      (auto | full_access | plan); each adapter maps it to its provider's modes.
- [ ] **6. local persistence** — thread-state and chrome caches persisted to
      IndexedDB, hydrated on boot before the socket connects; `afterSeq` catch-up
      heals whatever is behind. Persisted state can only be stale, never wrong;
      zod-validate on read, discard what doesn't parse. Instant reloads, Linear-style.
- [ ] **7. image paste** — clipboard/drop → client-side downscale → data URL over ws →
      attachments dir → base64 content block to Claude. Verify real Anthropic image
      limits here.
- [ ] **8. diff viewer** — unified patches (SDK `getWorkspaceDiff`, plain `git diff`
      fallback) rendered with `@pierre/diffs`.

Later, maybe:

- git/PR status per thread in the sidebar (working / open PR / merged) — `ThreadMeta.git`
  is already in the contracts; needs a server-side poller and a thread→branch
  heuristic since threads share the checkout.
- per-turn checkpoints, more agents via ACP, terminal stream, a desktop shell (PWA
  first).
- rewind: the SDK's `resumeSessionAt` resumes a session up to a specific message,
  and `rewindFiles` restores checkpointed files — together they'd give "go back to
  this point in the thread" (t3 tracks the same cursor for this).
- richer PermissionMode UX — revisit what modes we actually expose and how.
- subprojects / thread tags: in a monorepo (say `acme-stack/` with `apps/web`,
  `apps/admin`, `services/api`), agents run best from the repo root, so the whole
  repo is one jetty project — but most threads _operate_ in one area. A sidebar-only
  grouping (tag or path label per thread) would organize this without touching agent
  behaviour: cwd stays the project root, tags are pure UI.
- walk Jett through the subscription model (chrome vs per-thread, why not one global
  sub) properly — at latest as part of the chunk 4 design review.
- sound effects on actions (button clicks, sends, completions) — recent micro-trend,
  interested but not yet. Reference: https://cuelume-site.pages.dev/

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
- [ ] **3. claude adapter** — claude-agent-sdk sessions mapped to normalized events;
      resume across restarts, interrupt, `canUseTool` surfaced as approval items.
- [ ] **4. web app** — Vite React SPA: project/thread sidebar over `chrome.subscribe`,
      thread view with streaming timeline, composer. Default shadcn styling.
- [ ] **5. approvals + permission modes** — approval cards wired to `approval.respond`,
      permission mode picker per thread (default: auto).
- [ ] **6. image paste** — clipboard/drop → client-side downscale → data URL over ws →
      attachments dir → base64 content block to Claude. Verify real Anthropic image
      limits here.
- [ ] **7. diff viewer** — unified patches (SDK `getWorkspaceDiff`, plain `git diff`
      fallback) rendered with `@pierre/diffs`.

Later, maybe:

- git/PR status per thread in the sidebar (working / open PR / merged) — `ThreadMeta.git`
  is already in the contracts; needs a server-side poller and a thread→branch
  heuristic since threads share the checkout.
- per-turn checkpoints, more agents via ACP, terminal stream, a desktop shell (PWA
  first).
- richer PermissionMode UX — revisit what modes we actually expose and how.
- walk Jett through the subscription model (chrome vs per-thread, why not one global
  sub) properly — at latest as part of the chunk 4 design review.

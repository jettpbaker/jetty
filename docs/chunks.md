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
- [x] **4. web app** — Vite React SPA: project/thread sidebar over `chrome.subscribe`,
      thread view with streaming timeline, composer. Default shadcn styling.
- [x] **5. draft-first creation** — threads are born on first send, not on click:
      draft route per project (composer only), client-minted thread ids
      (`thread.create` takes a required id; server adopts idempotently, never
      mints), composer clears only
      on confirmed send. Design decisions in the opencode recon + decision notes
      below.
- [x] **6. local persistence** — thread-state and chrome caches persisted to
      IndexedDB, hydrated on boot before the socket connects; `afterSeq` catch-up
      heals whatever is behind. Persisted state can only be stale, never wrong;
      zod-validate on read, discard what doesn't parse. Instant reloads, Linear-style.
- [ ] **7. minimal approvals** — allow/deny buttons on the existing approval card,
      wired to `approval.respond`. Nothing else: no mode picker, no attribution,
      no card styling — just unblock threads that hit a permission prompt. The
      full approvals UX moves to the design pass (below).
- [ ] **8. image paste** — clipboard/drop → client-side downscale → data URL over ws →
      attachments dir → base64 content block to Claude. Verify real Anthropic image
      limits here.
- [ ] **9. diff viewer** — unified patches (SDK `getWorkspaceDiff`, plain `git diff`
      fallback) rendered with `@pierre/diffs`.

Design pass (the big one at the end) — collected UI/UX work that wants real
daily-driving mileage before deciding:

- permission modes: per-thread picker, surfaced set auto | full_access | plan as
  jetty vocabulary on the wire, each adapter maps to its provider's modes.
- approval card design + agent attribution (which agent is asking — hook inputs
  carry `agent_id`/`agent_type`).
- archive undo toast (sonner is installed; see the undo gap note below).
- tabs vs sidebar decision + subproject tags (notes below).
- icon tuning: Phosphor weights/strokes, per AGENTS.md.
- boot flash: index.html has no background until styles.css loads, so the
  pre-React window flashes browser-default (black in dark mode). Fix is inline
  critical CSS on `html` matching the app background (light oklch(1 0 0), dark
  oklch(0.145 0 0) via prefers-color-scheme) — duplicated from styles.css by
  necessity, comment linking the two.

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
- archive undo: archiving has no undo and no unarchive UI — the thread just leaves
  the sidebar (the `archived` flag is stored, nothing exposes it). Violates the
  prefer-undo-over-confirm rule in AGENTS.md; wants a toast-with-undo or an
  archived section. Chunk 5 plate or design pass.
- subagents + workflows rendering — SDK research done (2026-07, verified against
  code.claude.com/docs/en/agent-sdk/subagents, /typescript, /hooks, /workflows):
  - correlation: subagent spawns are `tool_use` blocks named `Agent` (still `Task`
    in system:init tools list); every message from inside a subagent carries
    `parent_tool_use_id` = the spawning tool_use id. `claude-translate.ts` types
    this field but ignores it today — a subagent turn would interleave into the
    main timeline and corrupt streaming ctx. Fix before rendering work.
  - verbosity is opt-in: default = tool call + final result only;
    `agentProgressSummaries: true` adds one-line `task_progress` messages
    (`{type, task_id, summary?}`); `forwardSubagentText: true` streams the
    subagent's text/thinking with `parent_tool_use_id` set — needed for a full
    nested transcript.
  - lifecycle: background-by-default since CLI v2.1.198 (results arrive out of
    order); `stop_task` control request kills one subagent; Agent tool_result
    text carries `agentId` for resume. Nesting to depth 5 (`parent_agent_id` in
    `getSessionMessages`). Subagent transcripts are separate files under
    `<session>/subagents/agent-<agentId>.jsonl`.
  - approvals: subagents don't inherit parent approvals — prompts route through
    the same `canUseTool`; UI must say which agent is asking (hook inputs carry
    `agent_id`/`agent_type`; frontmatter `color` is a free UI hint).
  - workflows are opaque by design: isolated run, only `task_progress`-style
    events + final report reach the stream — render as a progress card, a full
    transcript is impossible. `ultracode` keyword only triggers on messages
    stamped `origin: {kind: 'human'}` (jetty doesn't stamp today). Exact
    `Workflow` tool i/o schema unverified — check the npm `.d.ts` when needed.
  - behavior is CLI-version-gated; read `capabilities` off system:init instead of
    assuming.
  - design calls open (taste, check with Jett): flat items + `parentItemId` vs
    container item; which verbosity tier default-on; workflow card shape.
- subprojects / thread tags: in a monorepo (say `acme-stack/` with `apps/web`,
  `apps/admin`, `services/api`), agents run best from the repo root, so the whole
  repo is one jetty project — but most threads _operate_ in one area. A sidebar-only
  grouping (tag or path label per thread) would organize this without touching agent
  behaviour: cwd stays the project root, tags are pure UI.
- walk Jett through the subscription model (chrome vs per-thread, why not one global
  sub) properly — at latest as part of the chunk 4 design review.
- sound effects on actions (button clicks, sends, completions) — recent micro-trend,
  interested but not yet. Reference: https://cuelume-site.pages.dev/
- tabs instead of sidebar: browser-style tab bar, one tab per open session — real
  usage is 2-5 concurrent sessions, so sidebar vertical space may be wasted. Cheap
  to swap later (nav is one component deep; stores/routes/wire don't know the
  sidebar exists), and last-N warm subscriptions already are a tab model. Needs a
  Cmd+K palette for non-open threads (cmdk already vendored). Decide at the design
  pass alongside subproject tags — after daily-driving the sidebar.
  - opencode recon (2026-07, grok over their repo — packages/app is the desktop
    surface): tabs and "composer-first new session" are ONE mechanism. `Tab =
SessionTab | DraftTab`; a draft is the sessionless composer reified (uuid +
    `/new-session?draftId=` route). First submit: `session.create` →
    promoteDraft in place + navigate (atomic) → optimistic user message into the
    local store → promptAsync; on failure remove optimistic + restore composer
    from snapshot. Draft composer text persists per-draft, deleted on promote.
    Server never creates implicitly (message-to-missing-session = 404) — the
    pattern is pure client choreography, so jetty needs zero wire changes:
    thread.create → turn.start → promote. Their home is a session list, not the
    composer — "new anything" opens a draft. Router owns "what you're looking
    at"; the tab store owns the open set; deep links auto-open tabs. Their V1
    titler ≈ ours (hidden tool-denied agent, first prompt step, skip-if-renamed).
  - decision (Jett, 2026-07): jetty's draft-first creation uses CLIENT-MINTED
    thread ids (shared newId(); server adopts idempotently — error on projectId
    mismatch, retry-safe otherwise). Kills the draft→session promote state
    entirely: navigate to the real /thread/:id on first submit, requests chase
    the UI. Sequence create before turn.start on the wire; visible error + route
    home if create fails, composer text restored from snapshot.

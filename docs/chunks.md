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

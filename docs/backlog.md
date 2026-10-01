# backlog

Deferred on purpose. Delete items as they land; delete this file when it's empty.

## sketchpad designs not ported yet (needs Jett's call)

- Design rebuilt Settings (sidebar nav, merged Models page) after our port.
  Ignoring until Jett says otherwise.

## later

- Orca-style source-control actions: rebase from base, create PR, merge PR in-app.
- Accept `#<PR number>` as a worktree ref by fetching the PR head.
- Continue work on an existing branch.
- Command palette: removed in the v2 skeleton; no design yet.
- Monitoring state (next after worktrees and the icon swap; t3code's approach):
  when a Claude turn ends with background work still running in its session
  (background shells, Monitor watches), the thread reads Monitoring instead of
  idle, the session isn't retired by the idle TTL while that work runs, and
  output Claude emits when it wakes itself shows in the thread. In memory only;
  a restart clears it (the work is gone too). Design: sketchpad
  /components/monitoring variation E — the in-progress ring without its
  half-fill, muted foreground, no motion, label "Monitoring"; one collapsed
  line under the composer ("command +N · elapsed · Stop all", expanding to a
  Stop per task); same ring in the tab, and the hover card shows only
  "Monitoring · elapsed" (no command line).
- Later, if restarts keep killing waits: a Jetty-owned `wake_me` tool (a time
  plus an optional precheck command Jetty runs host-side; Orca's automations
  --precheck pattern) that survives restarts and works for every provider.
- Redesign the agent question card's answer options (composer_strip.tsx):
  multi-select answers use a checkbox and single-select a radio, filled when
  selected. Needs a proper design pass in the sketchpad (they were flagged in
  the icon swap).
- Per-worktree dev server ports (after worktrees v1, which ignores ports): Jetty
  gives each live worktree a slot number (JETTY_WORKTREE_SLOT, lowest free) and
  a project's setup script derives a port block from it (base + slot * 20, one
  offset per service). Figure out the work repo first: how many services an
  admin run needs, which ports are hardcoded (vite config, service-to-service
  URLs), and what's pinned outside the repo (OAuth redirects, CORS, flag
  setups registered for localhost). If those can't move, focused-thread
  forwarding (the thread you're viewing owns the default ports) is the
  fallback. Also: shared backend vs per-worktree, and the Linux inotify limit.
- Design Jetty's built-in agent instructions (server/src/jetty-instructions.ts)
  so agents understand the process and the ideal workflow: work out of a couple
  of orchestrator threads, children report up to their parent, the parent
  reports to the user (mark_ready_for_review), archive finished threads, etc.
  The optional parts become toggles in Settings → Agent behaviour.
  Jett reviews every place Jetty talks to agents, not just that file:
  1. the base instructions and the Agent behaviour sentences
     (server/src/jetty-instructions.ts, `agentBehaviours` in shared/src/wire.ts)
  2. the MCP tool descriptions (server/src/mcp.ts)
  3. the relayed-message wrapper and the child's report-back line
     (`agentText` in server/src/orchestrator.ts)
  4. system messages and tool results agents read ("Thread X failed: …",
     send_images/send_video results, MCP error texts)
- Slash / skill commands in the composer (`/verify`, `/pr`, …). The server
  already lists skills (`skills.list` in server/src/skills.ts reads project and
  user skills, including `user-invocable`), but no client uses it yet.
  How others do it (~/code/ctx, Sept 2026):
  - t3code (wraps provider CLIs, like us) puts three kinds in one `/` menu:
    built-ins applied locally (model, plan…), provider slash commands passed
    through as text (offered only at the start of the prompt, the only place
    providers expand them), and skills inserted as a `$name` chip usable
    anywhere (composerSlashCommandSearch.ts).
  - t3code discovers skills per provider, not from one scan: Codex app-server
    `skills/list`, `grok inspect --json` (includes plugin skills, honours
    disabled ones), and a filesystem scan for Claude (`~/.claude/skills` +
    `<cwd>/.claude/skills`, user wins on name clashes; the SDK init only gives
    names). `.agents/skills` is Codex-only.
  - Dispatch differs per provider (ClaudeSkillDispatch.ts): Codex parses `$name`
    natively. Claude only expands `/name args` when it opens the last text block,
    and only one per message, so t3code rewrites the last `$name` into a
    `/name <rest>` block and earlier ones to inline `/name` (the model runs
    those via its Skill tool). A `$word` that isn't a known skill stays literal
    (`$HOME`).
  - opencode (its own agent) keeps one command registry of custom commands, MCP
    prompts and skills (badged in the menu); `/name args` at the start calls a
    `session.command` endpoint that expands the template server-side, adding
    "Base directory for this skill: <dir>" so relative paths resolve.
    For us: follow t3code. Ask Codex and Grok for their own catalogs instead of
    scanning files, keep our scan for Claude, and do the `/name` rewrite for
    Claude.

- Long threads, after the streaming fix: opening one still sends its whole
  state, and the background save rewrites the whole JSON (~30ms every 2s at
  10MB while streaming). Next step: page snapshots by turns (t3code: last 10
  turns, then 20 per page) and slim tool output on the wire.
- Grok threads read idle while background subagents run: Grok emits no
  `subagent` items (its `spawn_subagent` call shows as a tool row that settles
  at once with "Subagent started in background"), so the reducer's "running
  subagent keeps the thread working" rule has nothing to see. Fix: translate
  `subagent_spawned`/`subagent_finished` (those without `workflow_run_id`) into
  subagent items keyed by `subagent_id`. Open question: their tabs would have
  no transcript.
- Grok runs commands in its own sandbox: `gh` can't reach the keychain token (401 on
  PR creation) and writes outside the project are blocked even after approval.
- Queued-message remove has no undo (needs a server-side hold).
- Workflows, after the v1 cut (status lines under the composer, sidebar working,
  a2a in-chat row, per-workflow stop): the detail view (c1 / c1b / c1c in the
  sketchpad) and resume. Resume plan: after a restart jetty resumes interrupted
  Claude workflows once, automatically; Resume shows only if that fails, you
  stopped it, or it's Grok (same-process resume only). States: Running, Finished,
  Failed, Stopped — no "Interrupted".
- Grok doesn't report context usage, so its ring stays empty.
- Bump `@anthropic-ai/claude-agent-sdk` now and then (Claude runs on the
  installed CLI; the SDK is just the protocol client).
- PR checks list design pass: jettpbaker/jetty-issues#11.

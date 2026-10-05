# backlog

Deferred on purpose. Delete items as they land; delete this file when it's empty.

## sketchpad designs not ported yet (needs Jett's call)

- Design rebuilt Settings (sidebar nav, merged Models page) after our port.
  Ignoring until Jett says otherwise.
- PR view E (sketchpad `pr_redesign/jetty_style.tsx`). Agreed for the port:
  mark generated files on the server (`git check-attr linguist-generated`, then
  known lock/minified/source-map/protobuf names, then a `@generated` /
  `Code generated … DO NOT EDIT` header) so Hide generated works; read GitHub's
  real `viewerDefaultMergeMethod` for the merge button's "last used"; and give
  the Changes tab the same diff skin (Jetty's status green/red). The checks
  list's design pass (jettpbaker/jetty-issues#11) is done there: grouped
  Failing / Running / Successful, skipped folded into one row.
- Picks waiting until the ported UI is polished (sketchpad on :5174):
  - Command palette, two looks: `/components/command-palette`, or in the app
    preview `/components/app?palette=a|b`.
  - Settings redesign, two looks (A Document, B Window): `/components/settings`,
    or `/components/app?settings=a|b`.
  - Issues view (`/components/issues`, `/components/issue-page`), keybind chips
    (`/components/keybinds`), and PR view E's review flows (comment from the
    gutter, start a review, suggest, submit with a verdict).
  - PR description edits are last-writer-wins across devices; an "edited
    elsewhere" guard is possible.
  - ⌥1–9 opens pinned threads; the alternative is driving tabs.
- How lists show a PR's checks and review state. The PR list's checks and review
  columns are gone: five unlabelled glyphs (failing, running, conflict, approved,
  changes requested) confused more than they told, and didn't look right yet.
  Worth finding one clear way to communicate it, in the PR list and on sidebar
  thread rows alike (`/components/thread-row-checks`: red already means a closed
  PR, so a mark can't just turn red; C, a separate failure disc and count, was
  recommended, but its running ring is the working-agent glyph).
- Custom merged and closed PR glyphs drawn on Lucide's open PR icon:
  `/components/pr-state-icons` (family D: merged with filled rings eased a quarter
  unit, closed with the ✕ on the top ring and equal gaps). Tried in the app
  (86b8a34) and reverted for now; come back to it.
- An icon for the PR overview's Thread row: `/components/icon-picks` (thread
  section). B (Message multiple 01) was recommended.

## later

- Orca-style source-control actions: rebase from base, create PR, merge PR in-app.
  Merge through GitHub's async merge API (GA 2026-10-01): a PUT to
  `/repos/{o}/{r}/pulls/{n}/merge-async` returns an id to poll (`pending` →
  `merged` | `enqueued` | `failed`; results kept 24h). One endpoint covers direct
  merge, merge queue and stacks. Pin `sha` to the head the user saw (a push
  mid-merge cancels it), keep `bypass_rules` false, and show the in-between
  states in the PR view: Merging…, In merge queue, Failed with the reason.
- Stacked PRs from parent/child threads: a child's worktree builds on its
  parent's, so their PRs could open as a GitHub stack, and one async merge of
  the top PR lands every downstack layer together or none of them. Needs a
  stack model in the GitHub client.
- Accept `#<PR number>` as a worktree ref by fetching the PR head.
- Continue work on an existing branch.
- Later, if restarts keep killing waits: a Jetty-owned `wake_me` tool (a time
  plus an optional precheck command Jetty runs host-side; Orca's automations
  --precheck pattern) that survives restarts and works for every provider.
- Redesign the agent question card's answer options (composer_strip.tsx). Of
  four sketchpad looks, Jett liked Tint best (no leading mark; the pick is
  tinted with a trailing tick), so the sketchpad's composer strip uses it for
  now. Still needs a proper redesign with Jett in the loop before it's ported.
- Per-worktree dev server ports (after worktrees v1, which ignores ports): Jetty
  gives each live worktree a slot number (JETTY_WORKTREE_SLOT, lowest free) and
  a project's setup script derives a port block from it (base + slot * 20, one
  offset per service). Figure out the work repo first: how many services an
  admin run needs, which ports are hardcoded (vite config, service-to-service
  URLs), and what's pinned outside the repo (OAuth redirects, CORS, flag
  setups registered for localhost). If those can't move, focused-thread
  forwarding (the thread you're viewing owns the default ports) is the
  fallback. Also: shared backend vs per-worktree, and the Linux inotify limit.
- Spotlight (Conductor's name), the alternative to per-worktree ports: toggle it
  on a worktree thread and Jetty mirrors that worktree's tracked files into the
  project checkout (snapshot commit, check it out), watching for the agent's
  edits, so the dev server already running there hot-reloads on the thread's
  code. One thread at a time, one-way; switching swaps, off restores the
  checkout. Open: the user's own uncommitted work in the checkout (stash or
  refuse), and Local threads writing there at the same time. Start with a POC.
- Design Jetty's built-in agent instructions (server/src/jetty-instructions.ts)
  so agents understand the process and the ideal workflow: work out of a couple
  of orchestrator threads, children report up to their parent, the parent
  reports to the user (mark_ready_for_review), archive finished threads, etc.
  The optional parts become toggles in Settings → Agent behaviour.
  Consider app-delivered completion/failure callbacks that notify and resume the
  coordinating thread, rather than relying solely on a worker's explicit report.
  Consider reliability across app restarts and duplicate delivery/retries.
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
- Code block syntax colours: chat and description code blocks (sketchpad
  `src/components/custom/code_block.tsx`, not ported) hardcode
  `pierre-light-soft` / `pierre-dark-soft`. Jett picked Cursor's theme for the PR
  view's diffs (the sketchpad's `pr_redesign/cursor_themes.ts`, with Jetty's
  diff colours over it); use it for code blocks too so code looks the same
  everywhere.
- Jetty bot avatar (sketchpad `/components/bot`, not ported): when bots land,
  call Jett's own bot Sauron.
- Binary files in the PR diff read `-0 +0` beside "Diff not shown". The header
  lives in the diff library's shadow DOM, so it needs a CSS poke or a library
  option.
- Linked-PR change detection misses changes that don't bump `updatedAt`
  (mergeability flips, thread resolution). If that bites, a 10-minute full
  refresh floor for linked PRs is a two-line addition (an open PR view already
  refreshes fully every 30s).
- Perf lab: exact frame counts need Chrome's 120 Hz begin-frame control, which
  is Linux-only (headless Chrome in Docker). A separate spike.
- Design pass on toasts (sonner), with Jett; not a priority. A first study is
  in the sketchpad at `/components/toasts` (Today, Card, Pill).
- Issues over GitHub Projects, with Jett. A first study is in the sketchpad at
  `/components/issues-projects`: a per-Project mapping gives fields roles
  (status category, priority level, type, sidebar section, row details), with
  List, Sidebar, Board and Setup looks over two fake Projects.

# backlog

Deferred on purpose. Delete items as they land; delete this file when it's empty.

## sketchpad designs not ported yet (needs Jett's call)

- Design rebuilt Settings (sidebar nav, merged Models page) after our port.
  Ignoring until Jett says otherwise.

## later

- Branches: branch picker is disabled and always reads "Branch" — nothing on the
  server fills `ThreadMeta.git`. Real switching probably wants a worktree per thread.
  From t3code: create the worktree on first send, store an explicit cwd per thread,
  reuse existing worktrees, recreate a missing one; never switch a checkout under a
  running agent; key worktree paths per repo; make branch deletion explicit.
  QA showed the cost: a manager's children working in worktrees the manager made
  show the project checkout in Changes. Containers solve it for container threads.
- Command palette: removed in the v2 skeleton; no design yet.
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
- Containers preview (JETTY_CONTAINERS=1): unproven on Linux/Coder (port proxy,
  resources, spot recovery) and for Claude/Grok inside containers (Claude needs a
  `claude setup-token` token, Grok an XAI_API_KEY).
  Container hooks, in order (Jetty stays toolchain-agnostic; builds, Docker host
  setup and verify stay with the project):
  1. Focused-thread forwarding: the thread you're looking at owns your real
     localhost ports (e.g. 5173), and switching threads moves the forward. No
     collisions, and anything configured for localhost (paypa flags) just works.
     Cost: only one container's app is reachable at a time.
  2. Shared clone from a read-only mirror Jetty maintains (12s → <1s per
     thread). The mirror is mounted at the same path in the container; fetch
     under a lock and never prune/gc objects clones rely on. Also saves disk:
     every thread's environment (~/.jetty/environments/<id>) stays on the home
     disk until the thread is deleted (idle stops don't free it; archiving
     unchecked), and today each holds its own full git history (~350 MB for
     paypa-stack) on top of node_modules (est. 2–4 GB per thread in total).
     Shared objects drop the history copy; node_modules stays per thread.
  3. Agent-visible preview links: an MCP tool (e.g. `dev_urls`) rather than
     env vars, since Docker assigns the host port at start. Mostly moot if 1
     lands.
  4. Start the agent while setup runs (saves ~18s on a thread's first message
     only; setup runs once per environment). Settle the edges first: the agent
     must know setup is still running and wait before building/testing/
     installing; a setup failure after the agent started needs a way into the
     thread and to the agent; dev services must wait for setup.
- Container archive that frees disk but stays resumable (idea, not started).
  Today archive only stops the container; the ~3 GB environment stays until
  delete. On archive: snapshot uncommitted + untracked work (respecting
  .gitignore) as a commit under refs/jetty/wip, `git bundle` the thread's branch
  and that ref minus the base commit, prove it restores, then delete checkout/
  and keep home/ (agent session), artifacts/ and the bundle. On the next message:
  clone at the base, apply the bundle, restore the wip tree, clear the setup
  marker so setup re-runs, resume the session. Open points:
  - Prove the bundle by restoring it into a temp clone of the host repo and
    comparing tree hashes, not just `git bundle verify` (which also checks the
    base commit still exists in the host repo).
  - The base commit can vanish from the host repo (amended/rebased local
    commits, gc). If it isn't on a remote-tracking branch at archive time,
    bundle without the base exclusion (bigger, but self-contained).
  - home/ may not be "a few MB": pnpm stores, Playwright browsers and other
    caches land under HOME. Measure; clearing known caches on archive is fine
    since setup re-runs.
  - Gitignored files the agent made are lost (copyFiles are re-copied on
    restore); staged vs unstaged isn't preserved. Both acceptable, but say so.
- Containers, not Jetty's job: building/refreshing images (use the workspace
  startup script or a timer; the automatic re-test picks up the result). Desktop streaming
  (jetty-streaming) stays a maybe for seeing several containers at once.
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
- Diff syntax highlighting is flaky: within one hunk, some keywords and braces
  lose their colour (e.g. one `await` pink, the next plain).
- PR checks list design pass: jettpbaker/jetty-issues#11.

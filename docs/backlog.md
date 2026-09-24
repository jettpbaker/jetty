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
- Containers preview (JETTY_CONTAINERS=1): unproven on Linux/Coder (port proxy,
  resources, spot recovery) and for Claude/Grok inside containers (Claude needs a
  `claude setup-token` token, Grok an XAI_API_KEY).
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
- PR checks vs GitHub: GitHub groups checks by result with a summary header
  ("All checks have passed"), collapses skipped ones, marks Required checks, and
  shows a status context's description and "Successful in 18s". Ours is one flat
  list with no Required marker, and a re-run check shows twice (running and
  passed).

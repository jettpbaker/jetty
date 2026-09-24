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
  Container hooks, in order (Jetty stays toolchain-agnostic; builds, Docker host
  setup and verify stay with the project):
  1. Image changes re-test themselves: when the tagged image changes, run Test
     configuration automatically, switch threads over when it passes, and stay
     on the old image if it fails. Today any rebuild blocks every container
     thread until someone re-tests (`registration` in containers.ts).
  2. Focused-thread forwarding: the thread you're looking at owns your real
     localhost ports (e.g. 5173), and switching threads moves the forward. No
     collisions, and anything configured for localhost (paypa flags) just works.
     Cost: only one container's app is reachable at a time.
  3. Shared clone from a read-only mirror Jetty maintains (12s → <1s per
     thread). The mirror is mounted at the same path in the container; fetch
     under a lock and never prune/gc objects clones rely on.
  4. Agent-visible preview links: an MCP tool (e.g. `dev_urls`) rather than
     env vars, since Docker assigns the host port at start. Mostly moot if 2
     lands.
     Not Jetty's job: building/refreshing images (use the workspace startup script
     or a timer; 1 picks up the result). Desktop streaming (jetty-streaming) stays
     a maybe for seeing several containers at once.
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

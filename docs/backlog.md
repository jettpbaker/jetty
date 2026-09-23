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
- Project icons: pick an emoji or an icon from a curated Phosphor list, per
  project. Emoji render as Microsoft Fluent **Flat** (github.com/microsoft/fluentui-emoji,
  MIT), never the OS font. The sketchpad's emoji-picker-react can load custom images
  via `getEmojiUrl`; Fluent assets are keyed by name, so map from their metadata.
- Workflows, after the v1 cut (status lines under the composer, sidebar working,
  a2a in-chat row, per-workflow stop): the detail view (c1 / c1b / c1c in the
  sketchpad) and resume. Resume plan: after a restart jetty resumes interrupted
  Claude workflows once, automatically; Resume shows only if that fails, you
  stopped it, or it's Grok (same-process resume only). States: Running, Finished,
  Failed, Stopped — no "Interrupted".
- Grok doesn't report context usage, so its ring stays empty.
- Bump `@anthropic-ai/claude-agent-sdk` now and then (Claude runs on the
  installed CLI; the SDK is just the protocol client).

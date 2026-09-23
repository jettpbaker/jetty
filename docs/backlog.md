# backlog

Deferred on purpose. Delete items as they land; delete this file when it's empty.

## sketchpad designs not ported yet (needs Jett's call)

- New-thread backdrop isn't ported — the Settings wallpaper only sets the accent,
  it's never shown. Design: `new_thread_backdrop.tsx` + ambient `ComposerShadow`.
- Thread hover card (sidebar row preview) dropped. Design: `thread_hover.tsx`.
- Details panel tabs are a plain TabsList. Design: `thread_details_tabs.tsx` —
  `+` open-tab menu, close ✕, drag reorder, Chat tab when full width.
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
- Grok doesn't report context usage, so its ring stays empty.
- Model discovery runs once at server start; logging in to a provider later
  needs a restart.
- Bump `@anthropic-ai/claude-agent-sdk` now and then (Claude runs on the
  installed CLI; the SDK is just the protocol client).

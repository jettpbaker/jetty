# jetty

A web UI for coding agents, built around one specific workflow: the agent runs on a
remote dev workspace, and I drive it from a local browser over an SSH port-forward.

The terminal over SSH is fine until you need to paste a screenshot — you can't. And
once threads pile up, I'd rather have them grouped by project in a sidebar than
scattered across terminal tabs. t3 code proved this shape works (server on the box,
web client local, one forwarded port), but using it daily surfaced enough things I'd
change that forking didn't make sense. jetty is the version that does exactly what I
need and nothing else.

## shape

One Bun process on the workspace serves everything on one port: the built SPA, a
small HTTP API, and a WebSocket. The browser talks typed messages over the socket,
and every update carries a monotonic sequence so reconnects catch up from where they
left off instead of re-fetching the world.

Claude Code is the only agent for now, wired through `@anthropic-ai/claude-agent-sdk`.
The server never stores or ships SDK types though — everything gets normalized into
jetty's own event vocabulary at the adapter boundary, so adding other agents later
(ACP covers most of them) is one new adapter, not a migration.

Stack: Bun + bun:sqlite, TypeScript, zod contracts in `shared/`, React 19 + Vite +
TanStack Router, Tailwind + shadcn chat components, oxlint + oxfmt.

## progress

Building in order, one chunk at a time:

- [ ] 1. contracts — event vocabulary + ws message catalog (`shared/`)
- [ ] 2. server skeleton — ws protocol, sqlite, fake echo agent to prove the pipeline
- [ ] 3. claude adapter — sdk → normalized events, resume, interrupt
- [ ] 4. web shell — sidebar, thread view, streaming chat
- [ ] 5. approvals + permission modes
- [ ] 6. image paste
- [ ] 7. diff viewer (sdk `getWorkspaceDiff` first)

Later, maybe: per-turn checkpoints, more agents via ACP, terminal stream, a desktop
shell (PWA first).

## how this gets built

Mostly by agents, deliberately paced so I actually understand my own codebase:

- each chunk: short design note, then the build, then a walkthrough of the files
  worth reading. The next chunk doesn't start until I've caught up.
- taste decisions — tech choices, UX — get checked with me first, every time.
- UI rides default shadcn styles until a dedicated design pass at the end.

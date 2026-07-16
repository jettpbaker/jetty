# jetty

A web UI for coding agents, built around one specific workflow: the agent runs on a
remote dev workspace, and I drive it from a local browser over an SSH port-forward.

The terminal over SSH is fine until you need to paste a screenshot; you can't. And
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
is one new adapter, not a migration.

Stack: Bun + bun:sqlite, TypeScript, zod contracts in `shared/`, React 19 + Vite +
TanStack Router, Tailwind + shadcn chat components, oxlint + oxfmt.

## progress

The chunk-by-chunk plan and current status live in [docs/chunks.md](docs/chunks.md).

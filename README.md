# jetty

A web UI for coding agents, built around one specific workflow: the agent runs on a
remote dev workspace, and I drive it from a local browser over an SSH port-forward.

The terminal over SSH is fine until you need to paste a screenshot; you can't. And
once threads pile up, I'd rather have them grouped by project in a sidebar than
scattered across terminal tabs. t3 code proved this shape works (server on the box,
web client local, one forwarded port), but using it daily surfaced enough things I'd
change that forking didn't make sense. jetty is the version that does exactly what I
need and nothing else.

## architecture

One Bun process on the workspace serves everything on one port: the built SPA, a
small HTTP API, and a WebSocket. The browser talks typed messages over the socket —
request/response for actions, subscription pushes for updates — with every contract
defined once as zod schemas in `shared/` that both sides import.

State comes in two kinds. Chrome state (projects and the thread list) is plain rows
with CRUD and change pushes. Timelines are an append-only event log per thread, one
monotonic `seq` per event: thread state is `reduce(events)`, and the same reducer
runs on both sides — the client applies live pushes, the server maintains a
projection for fast cold loads, and neither can drift from the other. Reconnects
just replay events after the last `seq` the client saw.

Agents sit behind a small seam: the orchestrator owns turn lifecycle and the single
append-then-broadcast path; an agent only emits normalized events and knows nothing
about sockets, sqlite, or sequence numbers. An echo agent implements the seam for
free UI development and tests.

The real agent is Claude Code, and the key division of labor: the CLI is a complete,
self-sufficient agent that owns its own conversation — context, compaction, tools,
transcripts under `~/.claude/projects/`. jetty feeds user input in, answers
permission prompts, watches the message stream, and translates what it sees into
jetty events. Our sqlite is a rendering ledger for humans, never fed back to Claude;
each thread keeps one resume pointer (`agent_session_id`) naming the transcript
Claude reloads.

Claude processes are spawned on demand and kept warm: a turn spawns `query()` in
streaming-input mode, messages sent while it works steer the active turn, and after
the last result the process stays warm for 10 minutes (`JETTY_SESSION_TTL_MS`)
before exiting. Quiet threads hold zero processes; the next warm session resumes
from the pointer (~0.7s spawn). Failure
handling is lazy everywhere: a dying stream is its own detection, every store is
append-as-you-go, and stale state is reconciled at the next boot instead of watched.

Claude runs on your installed Claude Code, so its auto-updates (and new models) reach
jetty without a dependency bump. `JETTY_CLAUDE_BIN` selects the executable (default
`claude`, resolved on the server's `PATH`); if it doesn't resolve, jetty falls back to
the Agent SDK's bundled CLI and logs a warning at startup.

Stack: Bun + bun:sqlite, TypeScript, zod contracts in `shared/`, React 19 + Vite +
TanStack Router, Tailwind + shadcn chat components, oxlint + oxfmt.

## Codex backend (v2)

Run `codex login status` on the server host to check the CLI's existing login,
then start Jetty with `JETTY_AGENT=codex bun run dev:server`. Claude remains the
implicit default; `JETTY_AGENT=echo` still needs no credentials. This is a backend
integration only; the replacement frontend is not wired yet.

`JETTY_CODEX_BIN` selects a CLI executable (default `codex`).
`JETTY_CODEX_MODEL` selects the default model; a turn's explicit model wins,
otherwise Codex uses its own configured model. Codex runs at standard speed.
Jetty does not read credentials, purchase credits, or fall back to an API key.

Codex owns its tools and conversation history. Jetty stores a separate Codex
resume pointer and opens a scoped app-server process per turn, closing it before
publishing completion. Restarting Jetty resumes the same Codex conversation.
Switching providers does not transfer their conversation histories.

## Grok Build backend (v2)

Install Grok Build and run `grok login`, then start the backend with
`JETTY_AGENT=grok bun run dev:server`. It uses the CLI's existing login, or an
explicitly configured `XAI_API_KEY`. No provider controls are added to the old UI.

`JETTY_GROK_BIN` overrides the CLI executable; `JETTY_GROK_MODEL` supplies an
optional model ID. Omitting the model, or passing `grok-build`, keeps the CLI's
advertised model. RPC callers can set model and reasoning effort per turn.

Grok owns its tools and stores its conversation history. Jetty persists a separate
Grok session pointer and loads it after a backend restart. Auto uses Grok's auto
permission mode and workspace sandbox; full access uses bypass permissions and
the off sandbox. Both disable plan mode. Each turn owns an isolated ACP process,
including steering, and closes it before publishing completion. Approvals and
questions use the existing backend RPCs. Provider quota/cost reporting is not
integrated.

The adapter follows [Grok's ACP documentation](https://docs.x.ai/build/cli/headless-scripting)
and the session, model-selection and xAI extension handling in
[T3 Code](https://github.com/pingdotgg/t3code). The opt-in real-provider smoke test is
`JETTY_GROK_LIVE_TEST=1 bun test server/src/grok-live.test.ts`; ordinary tests
use a local protocol fixture.

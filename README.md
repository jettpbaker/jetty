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

Stack: Bun + bun:sqlite, TypeScript, zod contracts in `shared/`, React 19 + Vite +
TanStack Router, Tailwind + shadcn chat components, oxlint + oxfmt.

## progress

The chunk-by-chunk plan and current status live in [docs/chunks.md](docs/chunks.md).

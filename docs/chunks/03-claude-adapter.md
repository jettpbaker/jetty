# chunk 3: claude adapter (`server/src/claude.ts`)

Replace the echo agent's seat with the real thing: `createClaudeAgent()` implementing
the same `Agent` type, backed by `@anthropic-ai/claude-agent-sdk`. When this chunk is
done, a ws client can start a turn and watch actual Claude Code work — streaming
text, real tool calls, approvals waiting on `approval.respond` — and a server restart
doesn't lose the conversation.

## decisions

1. **Query-per-turn with resume, not long-lived sessions.** Each turn calls the
   SDK's `query()` fresh, passing `resume: sessionId` from the previous turn; the
   CLI process exits when the turn ends. Costs ~a second of spawn time per turn,
   buys us: no idle process management, restart-safe by construction (the resume
   cursor is just a column), zero processes for quiet threads. The long-lived
   prompt-queue mode (faster follow-ups, mid-turn message queueing) is the known
   upgrade path — the `Agent` seam hides the difference.

2. **Resume cursor on the thread row.** New nullable column
   `threads.agent_session_id`, written when the SDK's init message reveals the
   session id. Restart the server, send a turn, Claude remembers the conversation.
   (Named provider-neutrally on purpose.)

3. **A pure translator, thin session loop.** The file splits in two:
   - `translate(msg, ctx): ThreadEvent[]` — a pure function from SDK messages to
     our events. All the mapping complexity lives here, unit-tested against
     fixture messages, no I/O.
   - the session loop — spawn `query()`, iterate messages, feed each through the
     translator, `emit` the results. Boring by design.

   Mapping (with `includePartialMessages: true` for streaming):
   - init → capture session id
   - text deltas → `item.delta` on an `assistant_message`; thinking deltas → on a
     `reasoning` item
   - `tool_use` block → `tool_call` item.started (input complete, output empty);
     matching `tool_result` → `item.delta` output + `item.completed` with status
   - result message → `turn.completed` with usage + costUsd (or `turn.failed`)

4. **Approvals fully plumbed server-side (UI stays chunk 5).** `canUseTool`
   emits an `approval` item + `session.status: awaiting_approval`, then parks the
   SDK's promise in a `Map<itemId, resolve>`. The `approval.respond` method (stubbed
   since chunk 2) resolves it — allow/deny, with `updatedPermissions` passed
   through. Turn interrupt also rejects any parked approvals for that thread.

5. **Sessions run with the user's real Claude setup.** `cwd` = the project's
   `path`, `systemPrompt: { preset: 'claude_code' }`, `settingSources:
   ['user', 'project', 'local']` — so CLAUDE.md files, skills, and MCP servers
   behave exactly like terminal Claude Code. `model` and `permissionMode` pass
   through from `turn.start` params; permission mode defaults to `auto`.

6. **Agent selection by env var.** `JETTY_AGENT=echo|claude`, default `claude`;
   echo stays wired for UI dev and tests. Tests: translator unit tests with SDK
   message fixtures + the existing integration suite on echo. One live-Claude
   integration test exists but is skipped unless `JETTY_LIVE_TEST=1` (it spends
   tokens; run manually).

## explicitly out

Attachments (chunk 6), mid-turn message queueing, AskUserQuestion/plan-mode
surfacing (approval UI territory, chunk 5 decides), model listing, per-thread
provider choice, MCP servers of our own.

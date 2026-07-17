# chunk 3: claude adapter (`server/src/claude.ts`)

Replace the echo agent's seat with the real thing: `createClaudeAgent()` implementing
the same `Agent` type, backed by `@anthropic-ai/claude-agent-sdk`. When this chunk is
done, a ws client can start a turn and watch actual Claude Code work — streaming
text, real tool calls, approvals waiting on `approval.respond` — and a server restart
doesn't lose the conversation.

## decisions

1. **Process-per-burst with resume.** A burst starts when a turn starts on a quiet
   thread: open `query()` in streaming-input mode with `resume: sessionId`, feed it
   a real queue. Messages sent while Claude works are pushed into the live queue
   (mid-turn queueing, t3-style) and run as follow-on turns in the same process.
   When the queue is drained and the last result message arrives, close the query —
   the process exits. Rapid-fire chat pays the ~1s spawn once per burst; quiet
   threads hold zero processes; restarts can only ever lose the in-flight burst
   (the resume cursor is a column, written every time init reveals it).

   What we deliberately don't build from t3's model: processes that survive
   *between* bursts, and the liveness/reaping/restart-reconciliation machinery
   they require. Streaming-input mode is non-negotiable either way — single-message
   mode supports neither `interrupt()` nor image attachments (chunk 6).
   Docs: code.claude.com/docs/en/agent-sdk/{sessions,streaming-vs-single-mode}.

   **Steer semantics:** a message sent while a turn runs joins the *active* turn
   (same `turnId`, pushed into the live queue; Claude absorbs it at its next step
   boundary — identical to typing into a running Claude Code terminal). No new
   turn boundary, one result at the end. The orchestrator emits the user item
   immediately under the active turnId. The `turn_active` error is retired from
   the ErrorCode enum; the chunk 2 test that asserts it becomes a steer test.
   The `Agent` type grows `steer(threadId, text): boolean` — false means no live
   session (lost race), and the orchestrator falls back to a fresh `startTurn`.
   EchoAgent implements steer naively so the behavior stays cheaply testable.

   **Idle TTL:** after a result, when the queue is empty, the query stays open for
   `JETTY_SESSION_TTL_MS` (default 5 minutes; 0 = close at result). A `turn.start`
   inside the window cancels the timer and runs as a fresh turn in the warm
   process — conversational replies skip the spawn cost. Timer fires → close. A
   warm process dying early is harmless: the stream-death handler (needed anyway)
   cleans up, and the next turn takes the normal spawn-with-resume path.

   **Failure handling** (no watchdogs, reconcile lazily):
   - stream throws / ends without result → `turn.failed(<error>)`, clean up map
     entry, thread back to idle; next turn resumes from the cursor.
   - startup reconciliation: at boot, any thread whose projected state isn't idle
     gets `turn.failed('server restarted')` appended — clears spinners frozen by
     a hard server death.
   - SIGINT/SIGTERM: interrupt active queries so in-flight turns end with real
     `turn.failed('server shutdown')` events, then exit. Minimal version only.

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

Attachments (chunk 6), AskUserQuestion/plan-mode
surfacing (approval UI territory, chunk 5 decides), model listing, per-thread
provider choice, MCP servers of our own.

# chunk 2: server skeleton (`server/`)

One Bun process proving the whole pipeline — request in, events appended, pushes
out — with a fake agent standing in for Claude. When this chunk is done you can
open two terminal ws clients, start a turn in one, and watch both stream the same
events; kill the server, restart, reconnect with `afterSeq`, and miss nothing.

## shape

```
server/src/
  main.ts          boot: config, db open, Bun.serve (http + ws upgrade on one port)
  db.ts            bun:sqlite open + migrations
  store.ts         chrome CRUD + event append/replay + thread state projection
  ws.ts            connection registry, request dispatch, subscription pushes
  agent.ts         the Agent interface + EchoAgent
  orchestrator.ts  turn lifecycle: owns "append then broadcast", one turn per thread
```

## decisions

1. **sqlite schema** — four tables, no ORM:

   ```
   projects       (id, path, title, created_at)
   threads        (id, project_id, title, status, archived, updated_at)
   thread_events  (thread_id, seq, ts, payload_json, PK (thread_id, seq))
   thread_states  (thread_id, state_json, last_seq)   -- the projection
   ```

   Append = one transaction: `seq = last_seq + 1`, insert event, run the shared
   reducer, write the new state json. The projection can never drift because it's
   the same `applyEvent` the client runs. Cold `thread.subscribe` = read one row.

2. **The Agent interface** — the seam Claude plugs into in chunk 3:

   ```ts
   type Agent = {
     startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void>
     interrupt(threadId: string): void
   }
   ```

   Agents emit normalized events and know nothing about ws, sqlite, or seq numbers —
   the orchestrator owns sequencing and fan-out.

3. **EchoAgent behavior** — exercises every streaming path the UI will need:
   emits a reasoning item, a fake `tool_call` (streams output, then succeeds), and
   an assistant message that echoes your text back in small delayed chunks, then
   `turn.completed` with fake usage. Interrupt cuts it off with `turn.failed`.

4. **State dir** — `~/.jetty/` for the sqlite db (`JETTY_HOME` to override; tests
   use a temp dir). Attachments dir comes in chunk 6; `turn.start` attachments are
   accepted-but-ignored until then.

5. **Multi-client from day one** — subscriptions are per-connection sets; every
   append fans out to all subscribers of that thread. This is nearly free now and
   painful to retrofit.

6. **Tests over a real socket** — boot the server on a random port with a temp db,
   drive it with Bun's WebSocket client: create/subscribe/turn/stream asserts, a
   reconnect-with-afterSeq replay test, and a two-client fan-out test.

## explicitly out

Claude (chunk 3), static SPA serving (chunk 4), attachments storage (chunk 6),
auth, graceful shutdown niceties, any config beyond port/host/home.

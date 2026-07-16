# chunk 1: contracts (`shared/`)

The contracts package is the mental model of the whole app: what a thread *is*, what
events flow through it, and what the browser and server say to each other. Both sides
import from here; nothing else in the codebase gets to invent a shape. zod v4 schemas
are the source of truth, TypeScript types are inferred from them.

Four decisions to settle before writing it.

## 1. two kinds of state: shell vs timeline

Not everything deserves event sourcing.

- **Shell state** (projects + thread list for the sidebar): plain rows, edited with
  plain CRUD. Subscribers get a snapshot on connect, then change notifications.
  There's no history worth keeping about a thread getting renamed.
- **Timeline state** (everything inside a thread): an append-only event log, one
  monotonic `seq` per thread. Client state is `reduce(events)`. This is the part
  where replay, reconnect catch-up, and debugging actually pay for themselves.

The server also maintains a materialized `thread_items` projection (same reducer,
run server-side) so cold-loading a thread is one query, not a replay of 10k deltas.
One reducer function lives in `shared/` and both sides use it — the projection can
never drift from what the client would compute.

## 2. the timeline model: items, not message soup

A thread timeline is a list of **items**, each with a lifecycle. Turns group them.

```
ThreadItem = one of:
  user_message     { text, attachments[] }
  assistant_message{ text }                       // streams
  reasoning        { text }                       // streams, collapsed by default
  tool_call        { toolName, input, output }    // output streams
  approval         { title, toolName, input, suggestions, decision? }
  plan             { text }                       // ExitPlanMode payloads
  error            { message }
```

Events over those items (the whole vocabulary, ~12):

```
turn.started      { turnId }
turn.completed    { turnId, usage?, costUsd? }
turn.failed       { turnId, error }
item.started      { item }                  // full initial item, typed as above
item.delta        { itemId, delta }         // text append (assistant, reasoning, tool output)
item.completed    { itemId, patch? }        // final fields (tool result, approval decision)
session.status    { status }                // idle | starting | running | awaiting_approval | error
```

Rationale: generic item events + typed item payloads keeps the reducer ~50 lines and
means a new item kind (e.g. a subagent card later) is a payload change, not four new
event types. This is flatter than t3's taxonomy on purpose.

## 3. ws protocol: requests + subscription streams on one socket

JSON frames, three shapes:

```
request   { id, method, params }        // client → server
response  { id, ok, result | error }    // server → client
push      { sub, seq?, data }           // server → client, per subscription
```

Method catalog (v1, complete):

```
shell.subscribe    → snapshot push, then shell change pushes
project.create     { path, title? }
thread.create      { projectId }        → threadId
thread.archive     { threadId }
thread.subscribe   { threadId, afterSeq } → events from afterSeq, live from there on
thread.unsubscribe { threadId }
turn.start         { threadId, text, attachments?[], model?, permissionMode? }
turn.interrupt     { threadId }
approval.respond   { threadId, requestId, decision, updatedPermissions? }
```

Attachments ride inside `turn.start` as data URLs (10MB/image, 8 max — t3's limits).
No REST endpoints in v1 except `GET /attachments/:id` for re-displaying images in
history. Reconnect = re-subscribe with your last seen `seq`; the server replays the
gap from sqlite. No auth in v1: bind 127.0.0.1, SSH is the boundary.

## 4. small calls

- **IDs**: uuidv7 everywhere (time-sortable, nice sqlite keys).
- **Layout**: `shared/src/{items,events,wire,reducer}.ts` — four files, no barrel
  cleverness.
- **Validation**: server parses every inbound request; client parses every inbound
  push. Costs nothing at personal scale, catches contract drift instantly.
- **Money/usage**: turn usage + cost land on `turn.completed` only. No live token
  ticker in v1.

## explicitly out (for later chunks or never)

Checkpoints, diffs (chunk 7 adds `thread.getDiff`), model listing, slash commands,
file @-mention suggestions, multi-environment anything, auth.

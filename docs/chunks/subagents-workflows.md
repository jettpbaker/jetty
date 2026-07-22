# Subagents & workflows in jetty — research + proposal

Covers the JET-17 (subagent views) and JET-20 (workflow) spikes. Research
verified against the installed SDK (`server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`,
0.3.2xx) — where docs and types disagreed, the types won.

## 1. How they work in Claude Code

**Subagents** (the Agent/Task tool): the model decides turn-by-turn to
delegate; each subagent runs in a fresh context and only its final message
returns to the parent as the tool result. Two modes:

- _Foreground_: parent waits; renders as an inline tool row with live spinner,
  description, and climbing token count.
- _Background_ (the default since 2.1.198): parent gets a task id and keeps
  going; results arrive later as a task notification. Claude Code lists these
  **under the prompt box** — a strip of live tasks (status glyph, description,
  age), expandable, `/tasks` to inspect.

**Workflows**: a JS orchestration script runs _outside_ the conversation and
fans out up to hundreds of agents (`agent()` / `pipeline()` / `phase()`);
intermediate results live in script variables, never in context; only the
final return lands in the conversation. Claude Code gives them the `/workflows`
view: a progress tree grouped by phase (agent count, token total, elapsed),
drill-in per agent, plus the same one-line summary in the under-prompt strip.

The distinction that matters for UI: a subagent is _part of the turn's story_
(it belongs in the timeline), while a workflow/background task is _ambient
work the session is doing_ (it outlives scrolling, and can outlive the turn —
it belongs to the session chrome, near the composer).

## 2. What the SDK actually gives us

All of this is in the installed types; none of it is consumed by jetty today
(`claude-translate.ts` drops every `parent_tool_use_id` message and every
system subtype except `init`).

| Message                              | Payload                                                                                                                                                               | Use                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `task_started`                       | `task_id`, `tool_use_id?`, `description`, `subagent_type?`, `task_type?`, `workflow_name?` (set when `task_type === 'local_workflow'`), `prompt?`, `skip_transcript?` | Create the task item / dock entry                                                                    |
| `task_progress`                      | `task_id`, `usage {total_tokens, tool_uses, duration_ms}`, `last_tool_name?`, `summary?`                                                                              | The live heartbeat                                                                                   |
| `task_updated`                       | `patch {status, description, is_backgrounded, error, end_time…}`                                                                                                      | Status transitions, foreground→background                                                            |
| `task_notification`                  | `status: completed\|failed\|stopped`, `summary`, `usage`, `output_file`                                                                                               | Settle the item; toast/badge                                                                         |
| `background_tasks_changed`           | full `tasks[]`, **replace semantics**                                                                                                                                 | The "is background work running" level signal — docs explicitly say to swap your set, not pair edges |
| `tool_progress`                      | `tool_use_id`, `tool_name`, `parent_tool_use_id`, `task_id?`, elapsed                                                                                                 | Per-tool ticks inside a subagent                                                                     |
| `forwardSubagentText: true` (option) | assistant/user messages with `parent_tool_use_id` set                                                                                                                 | Full nested subagent transcript — the SDK invites a nested-timeline UI                               |
| `tool_use_result` on user msgs       | `AgentToolCompletedOutput` — structured final report + run totals                                                                                                     | Render the result without parsing tool_result text                                                   |

Notes:

- Workflows surface as **one task** (`task_type: 'local_workflow'`). Per-phase
  / per-agent trees do **not** stream to SDK consumers — Claude Code's
  `/workflows` view reads process-internal state. So jetty can render a
  workflow's lifecycle + heartbeat, not its tree. (Drilling in would mean
  reading the run's transcript/journal files from disk — possible later, not
  in scope.)
- `task_started.tool_use_id` links a task to the Agent tool_use already in the
  timeline; `parent_tool_use_id` links nested messages the same way. Both ids
  are the glue between "timeline item" and "task".
- `skip_transcript` tasks are ambient/housekeeping — hide from the timeline,
  optionally show in the dock.

## 3. Logic-side proposal

Event-sourced like everything else; two additions.

**a. Upgrade the timeline item.** New item kind `task` (or extend `tool_call`
— see open questions), created when `task_started` arrives with a
`tool_use_id` we've seen (replacing the generic "Delegating" tool row):

```ts
kind: 'task',
taskId: string,
toolUseId: string,
description: string,
flavor: 'subagent' | 'workflow',      // from task_type
subagentType?: string,                 // 'Explore', 'general-purpose', …
workflowName?: string,
status: 'running' | 'completed' | 'failed' | 'stopped',
background: boolean,
usage?: { tokens: number; toolUses: number; durationMs: number },
lastToolName?: string,
summary?: string,                      // from task_notification
```

`task_progress` → `item.delta` patches (same pattern as reasoning `tokens`);
`task_updated`/`task_notification` → `item.completed` with patch. Reducer
merges; replay works for free.

**b. Session-level task set.** `background_tasks_changed` → a new
`session.tasks` wire event carrying the full replacement set. Client stores it
per-thread next to `status`; this drives the composer-adjacent dock. Replace
semantics per the SDK docs; reset to empty on process (re)start.

**Later (phase 2):** `forwardSubagentText: true` + routing
`parent_tool_use_id` messages into a _child item list_ keyed by the parent
task item, instead of dropping them — this is the nested-transcript unlock.
Needs a `parentId` on items and a reducer path that appends to a child
collection; the translate ctx grows a per-subagent streaming ctx. Meaningful
but contained work; not needed for v1.

## 4. UI-side proposals

Four options, composable rather than either/or. Mockups with dummy data in
the artifact (jetty tokens, both themes).

**A. Live task row** (timeline, minimal). The Task row stops being a mute
"Delegating…" and becomes:
`✦ Exploring auth flows — 24.1k tokens · 12 tools · Reading server/src/ws.ts`
with the shimmer verb while running, then settles to
`Explored auth flows — 52.3k tokens · 31 tools in 2m 04s`, expandable to the
final report (structured, from `tool_use_result`). This is the JET-9 token
counter pattern applied to tasks. Smallest change, biggest daily payoff.

**B. Task dock under the composer** (session chrome). jetty's analogue of
Claude Code's under-prompt strip: a slim row of task pills between timeline
and composer — status dot (pulsing while live), short description, live token
count. Click a pill → expands to a card (prompt, heartbeat detail, result
when done). Driven by `session.tasks` + the item stream. This is where
_background_ work lives once the timeline has scrolled on; it's also the
natural home for `skip_transcript` ambient tasks and multi-turn workflows.

**C. Workflow card** (timeline). Workflows get a slightly bigger inline
treatment than subagents: named card (`workflow_name`), lifecycle status,
aggregate heartbeat (agents can't be enumerated — show tokens/elapsed), and
the final return rendered when it lands. Honest about the SDK boundary: no
fake phase tree.

**D. Nested transcript drill-in** (phase 2). Expanding a task row opens an
indented mini-timeline of the subagent's own items (reasoning, tool rows —
the components already exist and nest cleanly). Depends on 3b's phase 2.
Claude-in-chrome-style "watch the worker think" — the taste risk is noise;
default collapsed, maybe cap depth at 1.

**Recommended path:** A + B first (A is the timeline story, B is the ambient
story — together they cover foreground and background), C rides along cheaply
(same item, different flavor render), D later behind its own chunk.

## Jett's direction (2026-07-21, after reviewing the mockups)

Forming, not final — but this is the picture to design toward:

- **One-off subagents: Option A is right.** Compact inline row, communicates
  state clearly. The drill-in isn't a nested/indented transcript (Option D's
  render) — instead, **clicking into a task row swaps the thread view's
  contents** to show the subagent's own transcript full-width, with a button
  to return to the main agent. Same timeline machinery, different item source;
  it's thread navigation reused, not a new component. (Data-wise this is still
  the phase-2 `forwardSubagentText` + `parent_tool_use_id` routing — the child
  items just render as a full view instead of an indented block.)
- **The empty left gutter gets a list of running subagents** — the ambient
  "what's alive right now" surface, instead of (or before) the composer dock.
  Fits the existing layout: the timeline column is centered with dead space
  either side.
- **Workflows are explicitly deferred.** They need much more work — the right
  level of detail is the hard part and the UI/UX has to be gotten correct, not
  approximated. Don't fold them into the subagent v1; treat as their own
  design effort later (JET-20 stays open).

## Open questions for Jett

1. New `task` item kind vs. extending `tool_call`? My lean: new kind — the
   shape diverged (heartbeat, flavor, background) and `tool_call` stays clean.
2. The click-into swap needs the subagent's items captured — so
   `forwardSubagentText` + child-item routing moves from "phase 2" into the
   core build. Capture from day one (even before the swap view ships) so
   history is complete, or only once the view exists?
3. Left-gutter subagent list: does it show only the current thread's live
   subagents, or all threads' (with a jump-to-thread affordance)? And what
   happens on narrow windows where the gutter vanishes?
4. Is the swapped-in subagent view read-only (a transcript), or eventually
   interactive (the SDK can resume a subagent by agentId)? Read-only v1
   presumably.

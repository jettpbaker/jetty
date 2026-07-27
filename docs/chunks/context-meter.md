# chunk: context meter

A context-window tracker under the composer: a small ring that fills as the
thread's context does, click for the breakdown. Shape borrowed from lexctx
(ring + percent trigger, popover with a segmented bar and a legend); the data
model follows what t3 code learned about the Claude Agent SDK.

## where the number comes from

`query.getContextUsage()` — a control request on the live SDK `Query`, so it
only works while a session is warm and only in streaming-input mode (which is
how `claude.ts` already spawns). It returns the CLI's own accounting:

- `totalTokens` — `input + cache_creation + cache_read` off the last API usage
  (no output tokens), or an estimate before the first assistant message
- `maxTokens` — the full window for the model (200k, or 1M on the beta)
- `autoCompactThreshold` / `isAutoCompactEnabled` — where compaction fires
- `categories[]` — system prompt, tools, MCP tools, memory files, messages,
  autocompact buffer…

t3 code calls it once per turn and falls back to summing `usage` off the
stream. jetty polls the control request instead — same authoritative numbers,
but live during a turn, and the categories come along for free.

## contracts

`ContextUsage` in `shared/src/events.ts`, a new `context.updated` event, and
`ThreadState.context: ContextUsage | null` so it survives a cold load like
everything else. The field defaults to `null` on parse, so states persisted
before this chunk still validate.

Polling is throttled (2.5s) and events are only appended when the number moved
by a meaningful step — the event log is a ledger, not a telemetry stream. Turn
end always emits the authoritative snapshot.

## mock data

The echo agent emits a plausible ramp (fixed system/tool slices, messages
growing per turn), so the meter is developable and demoable with no Claude auth.
`JETTY_ECHO_CONTEXT_PCT` seeds the starting fill for showing off the high-fill
states.

## ui

`ContextMeter` in the composer footer's right cluster, left of the model picker
— under the textarea, matching both references. Ring is 18px: `stroke-border`
track, `currentColor` arc so it idles muted and brightens on hover with the
ghost button, `text-destructive` past 90%. Popover carries percent, used/max,
the segmented bar (chart-1..5 neutrals), the legend, and the compaction note.

Hidden when there's no data yet (fresh thread, cold agent) and while the
approval/question dock has replaced the composer.

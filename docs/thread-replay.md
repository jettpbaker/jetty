# Production thread replay

Run `bun run dev:client` and open `/thread-replay.html`. No API server or provider is needed.

The page feeds recorded events through the production client's `foldUpdate` and shared reducer,
then renders the existing `ThreadList`, `WorkBlock`, tool/thinking rows and streaming Markdown.
An isolated atom registry supplies empty app metadata; it does not subscribe to the live app.
The old `/streaming-replay.html` remains a separate text-rendering experiment.

The local input is `client/streaming-replay.local/thread.json` (gitignored):

```json
{
  "wallAnchor": 1791641480851,
  "projectPath": "/path/to/project",
  "provider": "claude",
  "recording": {
    "id": "local-session",
    "title": "Local captured session",
    "fidelity": "server-observed",
    "capture": "complete",
    "durationMs": 31703,
    "inputs": []
  }
}
```

Use a full `session.viewer.json` from the existing capture as `recording`, and the tape header's
`wallAnchor` parsed to milliseconds. Keep all item kinds, including reasoning and tools. The
assistant-only reviewed projection cannot reproduce the work UI. Local recordings are not
repository fixtures and must not be committed.

Play runs once at the recorded pace. Restart gives every item a fresh playback identity so
production caches do not remember earlier reveals. Show completed inspects the final state.
Item timestamps are shifted to the playback's current wall clock so durations start correctly.

This capture observes events **before server batching**, not browser arrival. It starts at the
agent turn and omits the user's prompt. It exercises the production conversation components;
the app shell, composer, queue and pending approval controls are outside this view. There is no
pause, scrub or speed control: animations and timers run on their normal browser clock. Use a
complete 1× playback to evaluate motion and layout.

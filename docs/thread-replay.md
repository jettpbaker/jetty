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
pause, scrub or speed control in the live replay: animations and timers run on their normal
browser clock. Use a complete 1× playback to evaluate motion and layout.

## Recorded video preview

Start the Vite client on port 5175, then run:

```sh
bun scripts/capture-thread-preview.ts
```

The utility visits `/thread-replay.html?capture=1`, waits for fonts and the local recording,
then records the production conversation at 1× with one second of postroll. Capture mode
fills the viewport with the conversation and omits replay controls. It needs no API server,
provider authentication, or live thread connection. External HTTP requests are blocked.

The default viewport is 1000×800; use `--width` and `--height` to change it. `--url` selects
another localhost replay server. Playwright resolves from the project when installed, then
the bundled Codex runtime. Set `PLAYWRIGHT_MODULE` or pass `--playwright` for another module
path. Chromium is discovered in the Playwright browser cache; `CHROMIUM_EXECUTABLE` or
`--chromium` can select an installed `chrome-headless-shell`. Chrome application bundles
are rejected. `FFMPEG`/`FFPROBE` or `--ffmpeg`/`--ffprobe` override those executables.

Only `client/streaming-replay.local/preview.webm` and `preview.json` are saved. Both stay
gitignored alongside the input recording. Re-run the utility to refresh them after changing
production rendering. The manifest includes recording identity, capture time, source Git
revision, dimensions, measured duration, and measured frame count. Its revision identifies
HEAD; commit source changes before capture when the preview needs an exact source reference.

Playwright's native video capture samples at **25 fps**, including real browser animations.
The utility encodes seekable VP9 WebM at the same constant frame rate, writes front-loaded
seek cues, and verifies every frame timestamp plus a maximum one-second keyframe interval
with ffprobe. Frame stepping and slow motion inspect those recorded samples; they cannot
recover frames between samples or turn the capture into a 60 fps recording. Text and motion
also pass through Playwright's initial video compression before the final encoding.

Native recording starts when the browser page is created. The utility trims loading using
the recorded wall-clock playback dispatch timestamp, conservatively retaining about 250 ms
of the ready state. The initial hold can vary with browser startup; video frame positions
are precise within the encoded movie, rather than exact event-to-video timestamp alignment.
Replay fidelity remains limited by the original server-observed recording described above.

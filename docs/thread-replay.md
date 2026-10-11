# Production thread replay

Run `bun run dev:client` and open `/thread-replay.html`. No API server or provider is needed.

The page opens the recorded video preview by default. Its **Live** mode feeds recorded events through the production client's `foldUpdate` and shared reducer,
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

In Live mode, Play runs once at the recorded pace. Restart gives every item a fresh playback identity so
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
bun run replay:capture
```

The utility visits `/thread-replay.html?capture=1`, explicitly loads Geist and Paper Mono before
the first streamed label, and waits for the local recording,
then records the production conversation at 1× with one second of postroll. Capture mode
fills the viewport with the conversation and omits replay controls. It needs no API server,
provider authentication, or live thread connection. External HTTP requests are blocked.

Reload `/thread-replay.html` after capture. Recorded mode has a draggable timeline and frame
timecode (`minutes:seconds:frames`), previous/next frame buttons, play/pause and playback speeds.
Seeking pauses playback. Shortcuts are Space to play/pause, `<` / `>` (comma/period) to step one
frame, ← / → to skip one second, Shift ← / → to skip five seconds, and Home / End for the
first/last frame. Slow motion slows all captured motion, including CSS animations and JS timers.
This is video inspection: interact with the conversation itself in Live mode, and recapture
after changing production components.

The default viewport is 1000×800 CSS pixels, captured at 2× as a 2000×1600 video so text stays
sharp on Retina displays. `--width` and `--height` change the layout size; `--scale 1`, `2` or `3`
changes pixel density without changing that layout. `--url` selects
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

The utility captures PNG snapshots through Chromium's screenshot protocol, targeting 25 samples
per second while real browser animations run at 1×. Explicit screenshot scaling supplies actual
additional pixels; increasing Playwright's native video dimensions alone only pads its image.
Snapshot timestamps preserve elapsed time when capture runs slower. Encoding resamples them to
**25 fps**, repeating a snapshot when needed. Stepping inspects encoded frames, not every original
browser frame. This is not a 60 fps capture.

PNG snapshots avoid the native recorder's JPEG and VP8 compression stages. They are encoded once
as lossless VP9 WebM with broadly supported 4:2:0 color sampling, front-loaded seek cues and a
maximum one-second keyframe interval. ffprobe verifies dimensions, frame count and every encoded
timestamp. Temporary snapshots are removed after capture.

The video begins with a fixed 250 ms ready hold, then the turn and one second of postroll. Frame
positions are precise within the encoded movie; snapshot request times do not guarantee exact
browser presentation timestamps. Replay fidelity remains limited by the original server-observed
recording described above.

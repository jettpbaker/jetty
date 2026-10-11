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

If the first turn omits its user message, the replay supplies one at time zero so production
components show “Working” before reasoning arrives. Optional top-level `prompt` supplies its text;
otherwise the bubble says “Original prompt was not recorded.” This reconstructs the initial send
state without inventing a delay or changing recorded event times. Original send latency is unknown.

In Live mode, Play runs once at the recorded pace. Restart gives every item a fresh playback identity so
production caches do not remember earlier reveals. Show completed inspects the final state.
Item timestamps are shifted to the playback's current wall clock so durations start correctly.

The source capture observes events **before server batching**, not browser arrival. It starts at the
agent turn and omits the user's prompt; the replay reconstructs that message as described above.
It exercises the production conversation components;
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

The transport shows the absolute **Frame** number, starting at **0**. Use that number when reporting
a visual issue. To pull the exact encoded frame as a full-resolution PNG:

```sh
bun run replay:frame 123
```

The command prints its absolute image path and capture identity. Images stay gitignored under
`client/streaming-replay.local/frames/<capture-time>/`, so different captures keep separate images.
It selects by decoded frame index rather than approximate seek time. `--output FILE.png` overrides
the destination; `FFMPEG` or `--ffmpeg` selects the executable. Frame numbers refer to the currently
loaded capture; refresh the replay after recapturing.

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

The utility captures a continuous PNG screencast through Chromium's public protocol while real
browser animations run at 1×. A fixed device-pixel viewport supplies Retina detail without resizing
the capture surface between frames. Increasing Playwright's native video dimensions alone only pads
its image. Chromium's frame timestamps preserve elapsed time. Encoding resamples them to **60 fps**,
repeating a frame when the page is unchanged or capture falls behind. Stepping inspects encoded
frames; capturing every browser frame still depends on machine load.

PNG snapshots avoid the native recorder's JPEG and VP8 compression stages. They are encoded once
as lossless VP9 WebM with broadly supported 4:2:0 color sampling, front-loaded seek cues and a
maximum one-second keyframe interval. ffprobe verifies dimensions, frame count and every encoded
timestamp. Temporary snapshots are removed after capture.

The video begins with a fixed 250 ms ready hold, then the turn and one second of postroll. Frame
positions are precise within the encoded movie. Capture timestamps describe this replay browser,
not the original client's presentation. Replay fidelity remains limited by the original
server-observed recording described above.

## Isolated entrance comparison

Open `/work-motion.html` on the same Vite server to compare the current work block with a
raise-up entrance. Replay runs the same short Thinking → streamed reply → tool sequence on
both sides. The current side renders `WorkBlock`; the experiment reuses the production
Thinking, Markdown and tool components. Non-text entries use an 8px rise and fade, without
the height reveal; replies use only the production word fades.
The entrance reads the shared disclosure duration and easing tokens. Reduced motion uses
only a fade at the shared control duration. Streamed words use the production 300ms fade.
It has three entries and does not model history scrolling or end-of-turn collapse.

A second row reuses `ToolGroup` to show Reading 1 → 2 → 3 files → Read 3 files, alongside
Searching the web → Searched the web. Replay restarts every example, including the rolling
file count. The file disclosure can be expanded to inspect the individual calls.
The tool row also has its own Replay button, which leaves the entrance comparison running.

Character morph variations below it compare four dev-only Reading → Read transitions using
the existing Torph library: the original 250ms disclosure curve, the same curve at the 150ms
control duration, the original with a brief 1px blur, and 250ms with the stronger popup curve.
Each has an independent Replay button. The count stays at 3 to isolate the completion change,
which starts after one second. Reduced motion replaces movement and blur with the
control-duration fade. These experiments do not change the production tool label.

Production completion labels now switch instantly: Reading → Read, Editing → Edited,
Writing → Wrote, Thinking → Thought, Searching the web → Searched the web, and
Working → Worked. The file number roller and row entrances remain animated. The
character morph experiments stay on the work-motion page for comparison.

The transcript uses 13px Geist Sans for replies and activity labels, with Paper Mono for
code, paths and numeric readouts. Activity rows keep their 28px spacing. A reply fades to
muted over the shared 150ms control timing once a later activity arrives.

The live five-entry history follows new rows with the same interruptible scroll glide as
the conversation. Scrolling back stops it; reduced motion pins immediately. Consecutive
reasoning items share one Thinking row, preserving their token totals and expandable
summaries instead of adding a second bare Thought label.
The history follows layout height rather than animated overflow, so rolling digits and
row entrances cannot pull it past the last row and cause a snap when they finish.

# Perf research: measuring and hillclimbing Jetty's front end

Researched 2026-10-03. Claims marked **(verified)** were reproduced on this Mac (M5 Pro, Bun 1.4.2, Chrome for Testing 153) with a throwaway proof of concept in the scratchpad.

## 1. What the best teams do

- **Anthropic: [How we made claude.ai 3x faster](https://claude.dev/blog/how-we-made-claude-ai-faster).**
  - They chose four journeys (launch, start, load, send), 13 measurements in all, from field data.
  - In the lab they gate on counts rather than milliseconds, because "milliseconds are too flaky to use as a CI gate". Pure JS is measured as Valgrind instruction counts under `node --predictable`. The browser has a ladder of counts instead: React commits per interaction, V8 precise-coverage call counts, layout and style-recalc counts, and DOM mutations.
  - A counter is kept only once lowering it has been shown to move wall-clock time: −48% and −31% instructions gave −78% and −44% time.
  - The ceilings are checked in. A PR that raises one fails, and a daily job lowers them as counts fall.
  - Layout shifts are attributed to named regions in the field. The test is binary: red 20/20 on main, green 20/20 on the fix.
  - Streaming uses 120 Hz begin-frame stepping in headless Chrome: "exactly 240 frames for 240 begin-frames at 8.33 ms".
- **Anthropic: [Automating eval design and hillclimbing](https://claude.dev/blog/automating-eval-design-and-hillclimbing).**
  - First prove that the noise is smaller than the smallest win worth acting on.
  - Split the cases into train and test at random, and apply one root-cause patch per round.
  - Keep a patch only if train improves, test improves and nothing regresses. "Train up, test flat" means overfitting, so revert.
- **Lauren Tan (poteto).** She now works on Grok Bot at SpaceXAI, not at Anthropic ([X bio](https://x.com/poteto), [career post](https://x.com/poteto/status/2091768756687258052)).
  - Her `/control-glass` skill launched Cursor's dev build with CDP so that agents could click, throttle, take CPU profiles and heap snapshots, then loop reproduce → profile → change → remeasure. Each agent got its own worktree, ports and browser state ([post](https://x.com/poteto/status/2069824386283319343)).
  - It is generalised publicly as pstack's [`create-verification-skill`](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md).
  - Her [hillclimb playbook](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/hillclimb.md) reads: "one change, one measurement, keep or revert… never claim a win from code inspection". It freezes the harness, takes the median of N, and logs each attempt to `decision.tsv`.
  - Her [trace-forensics playbook](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/trace-forensics.md) dumps traces into SQLite and walks the hot path.
  - On style: "If a script can do it deterministically, use the script."
  - Her Grok Bot results include switching back to a view 868 → 27 ms ([post](https://x.com/poteto/status/2102504221648339170)).
- **Figma: [Keeping Figma fast](https://www.figma.com/blog/keeping-figma-fast/).**
  - Every PR runs headless Chromium on GPU VMs with a **20% pass margin**, which only catches egregious regressions.
  - They rejected instruction counts because their app is GPU, Wasm and I/O bound.
  - A small lab of real laptops handles bisects.
  - Jetty is DOM/JS bound, so counts do suit it.
- **VS Code: [chat perf harness, PR #309700](https://github.com/microsoft/vscode/pull/309700).** This is the closest analogue to what we want.
  - A **deterministic mock LLM** with zero latency, and Playwright-Electron driving the chat panel.
  - Timing, layout, rendering and memory are compared against a baseline with Welch's t-test. Runs can be resumed to add samples.
  - A leak job fits a regression line to post-GC heap size and DOM node count.
- **Slack: [Client tracing](https://slack.engineering/client-tracing-understanding-mobile-and-desktop-application-performance-at-scale/).**
  - `ViewLoadTracer` has two spans: `visible` (rendered from cache) and `up_to_date` (server caught up). This is exactly Jetty's "cached first, catch-up after" rule, so we should measure both phases.
- **Replit: [Lying to the browser about time](https://replit.com/blog/browsers-dont-want-to-be-cameras).** They step a virtual clock with BeginFrame to get deterministic frames.
- **Linear: [StyleX](https://linear.app/now/styling-linear-for-the-future-stylex).**
  - Runtime CSS-in-JS cost 20–35% of main-thread CPU on view-heavy pages.
  - Regressions are prevented by oxlint rules, not timing gates. A lint ban counts as a valid "budget".
- **Raycast: [deep dive](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast).** They track resident memory per process and turn off WebKit's rAF/timer throttling and its 60 fps cap.
- **Notion: [WASM SQLite](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite).** Navigation time in the field, compared experiment vs control. They fixed p95 by _racing_ the local cache against the network.
- **Vercel ([Speed Insights](https://vercel.com/docs/speed-insights/metrics)) and Shopify ([RUM dashboard](https://performance.shopify.com/blogs/blog/web-performance-dashboard)).** Both use p75 field vitals. These are page-load oriented and mostly irrelevant to a local SPA.
- **React: [19.2 Performance Tracks](https://react.dev/blog/2025/10/01/react-19-2) and the [Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1).**
  - The Scheduler and Components tracks show in dev and profiling builds only ([availability table](https://react.dev/reference/dev-tools/react-performance-tracks)).
  - The compiler is already enabled in Jetty (`client/vite.config.ts`).
- **Statistics references.**
  - [Tratt: minimum times mislead](https://tratt.net/laurie/blog/2019/minimum_times_tend_to_mislead_when_benchmarking.html): report a distribution, not the minimum.
  - [Kalibera & Jones](https://kar.kent.ac.uk/33611/45/p63-kaliber.pdf): repeat at the level with the most variance (process launches), and report effect-size confidence intervals.
  - [Speedometer 3](https://webkit.org/blog/15131/speedometer-3-0-the-best-way-yet-to-measure-browser-performance/): measure "sync" inside rAF, then "async" to a timer after the next rAF, so rendering work is included.

## 2. Recommended stack

### In-app module (`client/src/perf/`)

**Browser APIs.** All are Chromium-only, which is fine because the target is Chrome. Every feature is detected and fails silently.

| Signal               | API                                                                                                                                      | Why                                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Journey phases       | `performance.mark/measure` with a [User Timing L3 `detail`](https://w3c.github.io/user-timing/) of `{ devtools: { track: 'Jetty', … } }` | One call feeds the flight recorder, our observer, _and_ a custom DevTools track ([extensibility API](https://developer.chrome.com/docs/devtools/performance/extension)). `console.timeStamp` is cheaper but invisible to observers, so keep it for hot paths only. |
| Main-thread blocking | [`long-animation-frame`](https://developer.chrome.com/docs/web-platform/long-animation-frames)                                           | Gives `blockingDuration`, `styleAndLayoutStart`, and `scripts[]` with `invoker`, `sourceFunctionName`, `sourceCharPosition` and `forcedStyleAndLayoutDuration`. That is far better attribution than long tasks. Threshold 50 ms.                                   |
| Input latency        | [Event Timing](https://www.w3.org/TR/event-timing/) (`event`, `durationThreshold: 16`, `interactionId`)                                  | Splits each keystroke or click into input delay, processing and presentation. 16 ms is the floor.                                                                                                                                                                  |
| "Rendered"           | App calls `perf.mark('…:rendered')` in a layout effect, then the module resolves "painted" with Speedometer's rAF→`setTimeout`           | Element Timing only reports an element's _first_ paint, so it misses re-renders. Use [`paintTime`/`presentationTime`](https://w3c.github.io/paint-timing/) on LoAF entries where present.                                                                          |
| React commits        | Install a minimal `__REACT_DEVTOOLS_GLOBAL_HOOK__` _before_ React loads and count `onCommitFiberRoot` calls                              | Works in **production** builds with no profiling build and no bundle alias. This is the technique [bippy](https://github.com/aidenybai/bippy) and react-scan use. Hand-roll it in about 30 lines, and chain to the real DevTools hook if one exists.               |
| Layout shifts        | `layout-shift` with `sources[].node`, mapped to named regions via the nearest `data-perf-region` ancestor                                | The Anthropic approach ([spec](https://wicg.github.io/layout-instability/)). Count any shift where `hadRecentInput` is false.                                                                                                                                      |
| WS timing            | Wrap the socket's `onmessage` once in `net/connection.ts`: count, bytes, and handler duration per message type                           | Covers catch-up patch latency during thread switches.                                                                                                                                                                                                              |
| Soft navs            | Skip for now                                                                                                                             | The [final origin trial](https://developer.chrome.com/blog/final-soft-navigations-origin-trial) is Chrome 147–149. Our own journey marks are more precise.                                                                                                         |
| Yielding             | `scheduler.yield()` ([Chrome 129, Firefox 142](https://developer.chrome.com/blog/use-scheduler-yield))                                   | Belongs in fixes, not in measurement. Noted for hillclimbers.                                                                                                                                                                                                      |

**Record schema.** One NDJSON line per record. It holds IDs and numbers only, never content:

```ts
type PerfRecord = {
  v: 1
  t: number
  sid: string // epoch ms (timeOrigin + now), page-session id
  k: 'journey' | 'mark' | 'loaf' | 'event' | 'shift' | 'ws' | 'snapshot'
  n: string // 'thread.switch', 'composer.key', 'ws:turn.delta', …
  d?: number // duration ms
  jid?: string // journey instance id
  a?: Record<string, number | string | boolean> // threadId, region, counts, budgetMs, over…
}
```

- A `journey` record carries its phase splits (`input`, `local`, `rendered`, `painted`, `caughtUp`) and the counters accumulated while it was open (`commits`, `loafBlockingMs`, `shifts`, `wsMsgs`, `wsBytes`).
- A `snapshot` record is emitted when a journey goes over budget. It holds the LoAF `scripts[]`, the last 200 ring entries, and DOM node and heap counts. The source _URL plus position_ is kept, but never text.

**Separation.**

- The app touches perf in exactly three ways:
  - `import { perf } from '@/perf'`
  - about 10 one-line `perf.start/mark/end` calls at journey boundaries
  - `data-perf-region` attributes
- Observers, the hook and the flusher boot from one `import '@/perf/boot'` at the top of `main.tsx`, before React.
- An oxlint `no-restricted-imports` rule stops `perf/` from importing app modules. One exception is a type-only import of shared IDs.

**Flush and storage.**

- The ring buffer holds 2,000 records. It flushes every 10 s, at 500 records, and on `visibilitychange: hidden`.
- Flushing is a plain `fetch('/perf', { method: 'POST', keepalive: true })` with an NDJSON body.
- The server adds one small route that appends to `~/.jetty/perf/YYYY-MM-DD.ndjson`, rotates at 10 MB, and keeps 14 files.
- Not the WebSocket: that keeps perf out of the typed Effect protocol and the app's message timing.
- No compression: loopback is free, batches are kilobytes, and `keepalive` has a 64 KB cap anyway. Add `CompressionStream('gzip')` only if the remote workspace makes it matter.
- [`fetchLater`](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater) (Chrome 135, 64 KB) is a nice-to-have for the final flush.

**Overhead budget.**

- At most 0.1 ms main-thread time per interaction, and at most 1% extra scripting during a streamed reply.
- That rules out per-commit allocation (counters are integer increments) and per-delta records (aggregate per journey).
- The lab enforces this by running each journey with `?perf=off` and checking that counters and wall-clock are unchanged within the noise floor.

### Lab (`perf/`, its own workspace package that the app never imports)

**Driver: `Bun.WebView` with `backend: { type: 'chrome', path }`, plus raw CDP through `view.cdp()`.** This is bleeding-edge. It shipped in [Bun 1.3.12 and 1.4](https://bun.com/blog/bun-v1.4), and Jetty already requires Bun 1.4.2 or later.

What the POC verified on this Mac:

- It launched and navigated Chrome for Testing in 0.76 s.
- `Emulation.setCPUThrottlingRate` worked.
- `Performance.getMetrics` returned the same deltas on every run: LayoutCount 500/500/500, RecalcStyleCount 502/501/501. Wall-clock for the same click was 84, 173 and 254 ms.
- `Profiler.takePreciseCoverage({ callCount: true })` gave exact call counts per function (500/500/500).
- `Tracing.start({ transferMode: 'ReturnAsStream' })` then `IO.read` produced a 1.9 MB trace.
- CDP events arrive as DOM events on the view (`addEventListener('Tracing.tracingComplete')`).
- Input is trusted (`isTrusted === true`).

Why it beats the alternatives:

- **Over Playwright:** no dependency, no second browser download, no Node-compat layer, and its CDP access is the same CDP. Playwright's selling points (auto-waiting, cross-browser) don't matter for counting work in one Chrome.
- **Over puppeteer-core:** that is the proven fallback. Bun had a [puppeteer WebSocket bug](https://github.com/oven-sh/bun/issues/24388), now closed. Puppeteer's [BiDi mode](https://pptr.dev/webdriver-bidi) is out because it lacks tracing, coverage and CPU throttling.
- **WebDriver BiDi** is out for the same reason.
- **Over crossbench:** [crossbench](https://chromium.googlesource.com/crossbench/+/refs/heads/main/README.md) is Python and aimed at browser vendors.
- **Over tachometer:** [tachometer](https://github.com/google/tachometer) uses Selenium and was **archived in September 2026**. We should borrow its ideas (auto-sampling, interleaving), not the tool.
- **Over Lighthouse user flows:** they are page-load scoring.
- **Over Vitest 5 bench:** it suits micro-benchmarks of pure functions such as markdown or diff parsing. Add it later only if a hot path needs instruction-level work.

**Browser.** Pin a [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) version in `perf/chrome.json` and install it with `bunx @puppeteer/browsers install chrome@<ver>`. Counters change between Chrome versions, so each baseline records the version it ran on.

**How it starts the app.**

1. `bun run build`.
2. For each variant, spawn `bun server/src/main.ts` with `JETTY_HOME=<tmp clone>`, `PORT=<free port>` and `JETTY_AGENT=echo`, plus `PATH=perf/bin:$PATH`. `perf/bin/gh` is a fake `gh` that replays recorded PR JSON, so the PR view never touches GitHub (the server resolves `gh` via `Bun.which`).
3. Readiness is a poll of `GET /`. Teardown kills the process group.

**Fixtures.**

- Seed through the **real protocol**, not raw SQLite. `perf/seed.ts` drives the server over its WebSocket using `@jetty/shared` types, and the echo agent fills the turns. Seeds therefore survive schema changes.
- The seed set is one project with a git repo and a branch, plus threads named `small`, `long` (200 turns), `code` (big fenced blocks) and `diff` (a linked PR).
- After seeding, freeze the result as a golden `JETTY_HOME`, keyed by a hash of `server/src/db.ts` and `seed.ts`. Each run copies it with `cp -c`, an instant APFS clone.

**Runner and statistics.**

- **Tier 1, deterministic. These are what gates and hillclimbing use.**
  - React commits, from the page hook.
  - V8 call counts for app functions (precise coverage, filtered to the app chunk).
  - `LayoutCount` and `RecalcStyleCount`.
  - DOM mutations (a `MutationObserver` count) and peak DOM nodes.
  - WS messages and bytes.
  - Layout shifts per region, and LoAF count.
  - If one of these varies across iterations, report it as nondeterminism. That is a bug or flake signal, not noise.
- **Tier 2, low noise.** `ScriptDuration`, `TaskDuration`, LoAF `blockingDuration`, and Event Timing processing time.
- **Tier 3, wall-clock.** Journey ms (input → painted).
- **Protocol for each journey.**
  - A fixed 4× CPU throttle and a 1440×900 viewport.
  - One warm-up pass that is discarded.
  - N = 10 iterations, **interleaved A/B/A/B** when comparing builds, with a fresh page per iteration and the server reused within a variant.
  - Report the median and a **bootstrap 95% CI of the median difference**. That is about 20 lines and needs no assumption of normality. VS Code uses Welch's t-test instead.
  - **Noise floor:** an A/A run of the same build, stored in the baseline. A wall-clock change counts only if its CI excludes zero _and_ exceeds the floor.
  - **Never use minimums** (per Tratt).
- **Laptop hygiene.**
  - Run `caffeinate -dimsu` and require AC power.
  - Refuse to run under thermal pressure, using `pmset -g therm` (on Apple silicon `powermetrics`/`sudo` may be needed, so treat this as best effort).
  - Run one variant at a time, never in parallel.

**Output.**

- `perf/out/<iso>/runs.ndjson`: one line per iteration, with journey, variant, gitSha, chrome version, counters and wall.
- `report.md`: one table per journey of median, CI and Δ against the baseline.
- `perf/baseline.json`.
- `perf/budgets.json` maps each journey to its ceilings, for example `{ "thread.switch": { "commits": 3, "recalcs": 4, "wallMs": 40 } }`. It is report-only for now. `bun perf ratchet` lowers a ceiling only when the new baseline beats it beyond the noise floor.

**Streaming frame rate.** 120 Hz begin-frame stepping is **Linux-only**.

- The CDP schema says `enableBeginFrameControl` is "headless shell only, not supported on MacOS yet". **(verified)** Launching `chrome-headless-shell` on macOS with `--enable-begin-frame-control` killed the pipe on the first `beginFrame`.
- Phase 1 measures streaming with LoAF `blockingDuration`, LoAF count, and frame events from the trace, all under throttling.
- The exact-frame rig runs Chrome in a Linux container. Docker is installed here.

### Trace analysis (`perf/analyze/`)

- **`@paulirish/trace_engine`.** This is the DevTools Performance panel's own engine, published as a library. **(verified)** In Bun it parsed the 1.9 MB trace in 75 ms. It exposed `UserInteractions`, `LayoutShifts`, `Samples`, `Invalidations`, `SelectorStats` and `UserTimings`, plus insights including `INPBreakdown`, `CLSCulprits`, `ForcedReflow`, `SlowCSSSelector` and `DOMSize`. It needs a `DOMRect` polyfill.
- **What an agent gets.** `analyze.ts` turns one trace into `trace-summary.md`:
  - the top 15 self-time functions, bottom-up from samples, source-mapped through the Vite build's hidden sourcemaps
  - forced reflows with their call sites
  - LoAF scripts
  - insight one-liners
  - our `Jetty` track marks
- **React commit causes.** Lab builds use `vite --mode perf`, which aliases `react-dom/client` to `react-dom/profiling`. React's Scheduler and Components tracks then appear in the trace.
- **Wrong path:** feeding an agent the raw 2 MB JSON.
- **Interactive digging:** [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) v1.10 and its new CLI (`performance_start_trace` / `performance_analyze_insight`, `emulate --cpuThrottlingRate`) are the agent's microscope against a lab-started Jetty. Pass `--no-performance-crux`. They are a supplement, not the harness: MCP round-trips are too slow and too uncontrolled for N=10 statistics.

## 3. Risks and unknowns

1. **`Bun.WebView` is about 6 months old.** The API is small (no tabs, no attach-to-existing). If it blocks us, swap the driver for puppeteer-core. Isolate it behind about 6 functions in `perf/driver.ts` (`launch`, `cdp`, `on`, `click`, `type`, `close`).
2. **The 120 Hz rig needs Linux.** Docker on Apple silicon runs arm64 Chrome-for-Testing builds, and headless-shell begin-frame on Linux arm64 is unverified. Budget a spike before relying on it.
3. **The echo agent streams only 4 chunks** (`emitChunks` in `server/src/agent.ts`). The long-streaming and type-while-streaming journeys need many small deltas. That means a small **app change** (an echo option for chunk count and pace), which **needs Jett's OK**.
4. **The DevTools hook can collide** with the React DevTools extension (lab Chrome has none). Chain to the existing hook, and turn it off with `?perf=off`.
5. **The trace engine API is "NOT FOR PUBLIC CONSUMPTION"** (README) and may break on upgrade. Pin the version.
6. **`Performance.getMetrics` counts the whole page.** Read deltas around each journey and keep other timers quiet: pause the context-ring poller and any shader animation in fixtures, otherwise counts drift. CPU throttling slows JS but not GPU or compositor work.
7. **macOS noise.** Thermal throttling, Spotlight and Time Machine, App Nap for background Chrome (headless is fine), and E-core vs P-core scheduling. This is why the gates use tier 1, and why wall-clock needs interleaving and an A/A floor.
8. **Field data comes from one user on one or two machines.** The flight recorder is there for regressions and over-budget snapshots, not for p75 statistics.
9. **The remote dev workspace** serves the built client over a network. The flight recorder should record `navigator.connection` and the page origin, so remote runs aren't mixed with local ones.

## 4. Phase-1 build plan

```
client/src/perf/
  boot.ts        observers (LoAF, event, layout-shift), DevTools hook, flusher; imported first in main.tsx
  index.ts       perf.start(journey, ids) / perf.mark(phase) / perf.end() → journey records, budget check
  ring.ts        ring buffer + flush (fetch keepalive POST /perf)
  regions.ts     data-perf-region lookup for shift sources
  budgets.ts     field budgets per journey (generated from perf/budgets.json)
server/src/perf-sink.ts   POST /perf → ~/.jetty/perf/*.ndjson, rotate 10 MB × 14
perf/                     own package.json (workspace "perf"), never imported by client/server
  chrome.json  budgets.json  baseline.json
  bin/gh       fake gh replaying fixtures/pr/*.json
  driver.ts    Bun.WebView + CDP wrapper (swap point)
  app.ts       build, spawn server on temp JETTY_HOME/free port, readiness, teardown
  seed.ts      drive WS protocol to create golden JETTY_HOME; hash-keyed cache
  counters.ts  getMetrics deltas, precise coverage, page-side counters (commits, mutations, ws)
  journeys/    launch.ts switch-loaded.ts open-unloaded.ts send-first-text.ts stream.ts pr-diff.ts type-while-streaming.ts
  run.ts       N iterations, warm-up, interleave, A/A floor → out/<iso>/runs.ndjson
  stats.ts     median, bootstrap CI of difference
  report.ts    report.md + budgets compare (report-only) + `ratchet`
  analyze/     trace_engine → trace-summary.md
```

1. **The in-app module.** Write `boot.ts`, `ring.ts` and the server sink. Check that `~/.jetty/perf/*.ndjson` fills during normal use and that `?perf=off` really is off.
2. **Journey marks.** Add `perf.start/mark/end` at the 7 journey boundaries and `data-perf-region` on the shell regions (sidebar, thread header, message list, composer, PR panel). Thread switch gets the phases `local → rendered → painted → caughtUp`, matching Slack's visible and up_to_date.
3. **The lab skeleton.** Write `driver.ts`, `app.ts` and `seed.ts`, then the golden home. Make `bun perf run --journey switch-loaded -n 3` print counters.
4. **Counters and statistics.** Write `counters.ts`, `run.ts` and `stats.ts`. Run the A/A noise floor, then check that tier-1 counters are identical across iterations and fix any drift sources.
5. **The remaining journeys.** The fake `gh` comes in for PR/Diff. The streaming journeys wait for the echo change (risk 3).
6. **Reporting.** Generate `report.md`, then the first `baseline.json` and `budgets.json`. Set ceilings at the current value plus the noise floor for wall time, and at exactly the current value for tier-1 counts.
7. **`analyze/trace-summary.md`.** Use a perf-mode build with profiling React.
8. **Later:** the Linux begin-frame rig for streaming at 120 Hz.

**Phase-2 hook.** A hillclimb round is:

1. Pick one journey (the train set).
2. Make one patch.
3. Run `bun perf run --compare HEAD~1`.
4. Keep the patch only if its target tier-1 counter drops, wall-clock does not get worse beyond the noise floor, and **no other journey's tier-1 counter rises**.

The held-out "test" set is the same journeys on different fixtures (other thread sizes), which catches fixture-overfitting. Log every attempt in poteto's `decision.tsv` format.

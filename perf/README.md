# perf lab

Runs Jetty's user journeys against a throwaway Jetty and returns repeatable numbers to
hillclimb against. Background and design: [`RESEARCH.md`](RESEARCH.md).

The lab is its own workspace package; the app never imports it. It talks to the app only
through the in-app module's page global (`window.__jettyPerf`), `data-perf-region`
attributes, environment variables, and the real WebSocket protocol for seeding.

## Commands

```sh
bun perf run                         # all journeys, n = 10, report in perf/out/<iso>/
bun perf run -n 3 --journey thread.switch/long,pr.open
bun perf run --save                  # …and write perf/baseline.json
bun perf compare HEAD~1              # A/B, interleaved; alias: bun perf run --compare HEAD~1
bun perf noise                       # A/A of one build; writes the wall-clock noise floor
bun perf ratchet                     # lower perf/budgets.json ceilings to the baseline
bun perf analyze thread.switch/long  # trace one journey → trace-summary.md
bun perf record-gh                   # re-record GitHub fixtures (needs `gh auth`)
bun perf seed [--force]              # build the golden JETTY_HOME
```

Each run writes `runs.ndjson` (one line per iteration) and `report.md` to `perf/out/<iso>/`,
which is gitignored. The first run installs the pinned Chrome for Testing (`chrome.json`)
into `~/Library/Caches/jetty-perf`, where golden homes are cached too.

## What a run does

1. Copies the working tree (or `git worktree add`s the ref) to a temp dir, installs, and
   builds the client with hidden sourcemaps. `analyze` builds with React's profiling build
   instead, for its Scheduler and Components tracks; measured runs don't, because its timers
   make commit work depend on elapsed time.
2. Clones the golden home (`cp -c`) and starts the server on a free port with the echo
   agent, `perf/bin/gh` on `PATH`, and `JETTY_GITHUB_API_URL` pointing at `github.ts`, a
   local fake api.github.com. Journeys that set echo pacing get their own server.
3. Per journey: one discarded warm-up, then n iterations, each in a fresh tab (4× CPU
   throttle, 1440×900, storage cleared, remote URLs blocked). The journey finishes when its
   record comes out of `__jettyPerf.take()` (a DOM condition is the fallback), then the
   page must be quiet for 500 ms before counters are read.

## Numbers

- **Tier 1, exact: what gates and hillclimbing use.** React `commits`, `jsCalls` (V8
  precise-coverage call counts in the app's chunks, minus the perf module), `mutations` (a
  lab-injected MutationObserver), `domNodes`, `wsMsgs`/`wsBytes`, layout `shifts` per
  region. If one of these varies between iterations of the same build, the report says so
  loudly and names the functions whose call counts moved.
- **Tier 1, frame-batched:** `layouts`, `styleRecalcs`, `loafCount`. They count rendering
  passes, and macOS Chrome can't pin frame timing, so they jitter by a pass or two. Compare
  ranges.
- **Tier 2:** `scriptMs`, `taskMs`, `layoutMs`, `recalcMs`, `loafBlockingMs`.
- **Tier 3:** wall-clock from the journey record (input → painted): median and bootstrap 95%
  CI. A change counts only when its CI excludes zero and it exceeds the A/A noise floor.

To keep tier 1 exact the lab: finishes CSS transitions and animations on the next frame,
parks the mouse after each click so hover cards don't open on their own timers, starts each
journey just after the app's 5 s RPC pong, polls only `take()` while a journey runs, and
measures with production React. Known remaining drift is app behaviour, and the report
shows it.

## Fixtures

- `seed.ts`: one project (a git repo with a branch) and the threads `small`, `long` (200
  turns), `code` (big fenced blocks) and `diff` (linked to `jettpbaker/pr-lab#1`), seeded
  over the protocol. The cache key hashes `seed.ts`, the server's `db.ts` and `agent.ts`,
  and the fixture list.
- `fixtures/gh/`: what the fake `gh` replays, keyed by normalised arguments. The server
  calls the API directly, so the fake api.github.com hands each request to the fake `gh` as
  the `gh api` call the server used to make for it. A missing fixture fails like an
  unreachable API and is flagged in the report. When the server's
  GitHub queries change, run `bun perf record-gh`.

## Hygiene

Refuses to run on battery, warns when the CPU is busy (other agents building), and keeps
the Mac awake while running. Run one lab at a time.

## Sandbox

`bun sandbox` is for clicking around, not measuring: the working tree's server (echo
agent) and Vite on free ports, on a home seeded like the lab's plus threads linked to
pr-lab's `sandbox`-labelled PRs (failing, running, draft, conflicting, closed, and a big
reviewed one). GitHub is real, so merging and reviewing there really happens; #1–#5 stay
the lab's. Each checkout's home persists in `~/Library/Caches/jetty-sandbox/<checkout>/live`;
`--fresh` reseeds it.
`--replay` runs a fresh copy of the golden home on the recorded fixtures instead, offline.

## Huge PR benchmark (opt-in)

```sh
bun perf record-gh --huge
bun perf run -n 3 --journey pr.diff/huge,pr.scroll/huge
```

`oven-sh/bun#30412` (2,188 files, +1M lines) is too big to commit, so `--huge` records it
into `~/Library/Caches/jetty-perf/gh-huge`; other calls fall back to the committed
fixtures. Both cases skip until it's recorded and never run by default. `pr.diff/huge`
times the Diff tab to the first painted file; `pr.scroll/huge` sends ten wheel inputs and
reports long tasks, total blocking time, the longest frame gap and frames with a blank
diff. Re-record after changing GitHub queries.

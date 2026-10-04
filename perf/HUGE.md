# Bun rewrite PR: part 1 measurements

Measured 2026-10-04 on this Mac (18 CPU cores), Chrome for Testing 154.0.8037.92,
1440×900, with the lab's 4× CPU throttle for client measurements. Large GitHub responses
are cached outside git. Commands and metric definitions are in [README.md](README.md#huge-pr-benchmark-opt-in).

## What failed

A cold `oven-sh/bun#30412` refresh failed after **70.8 s**. Its main GraphQL query
succeeded in 5.6 s; nested review-thread pages took 1.7–3.5 s. All 22 REST file pages
succeeded (0.57–1.30 s each). The final classification query, spanning **256 directories**,
returned **HTTP 502 after 11.5 s**. A 20-directory batch also failed after 10.6 s;
batches of five completed. Classification can split failed batches further, and
connection reads can retry with smaller page sizes. Independent pages now overlap.
Small PRs retain their original queries and round-trip count.

The original subscription eventually displayed `unavailable` in the sandbox. Background
refresh defects and failed publication previously had silent paths; both now publish a
failed state. Cached good data remains available when a background refresh fails.

## Fetch, payload and storage

| Measurement                                                      |           Before |         After |
| ---------------------------------------------------------------- | ---------------: | ------------: |
| Original cold live fetch                                         | 70.8 s, HTTP 502 | 53.7 s, ready |
| Recovered snapshot, UTF-8 JSON                                   |        20.805 MB |      5.664 MB |
| WebSocket traffic while opening cached Overview, CDP UTF-8 bytes |        20.809 MB |      5.667 MB |
| Client heap after cached Overview                                |   106.6–113.1 MB |  74.7–75.5 MB |
| Fresh server RSS after serving cached Overview                   |       416–442 MB |    232–249 MB |
| PR's SQLite JSON column                                          |        20.805 MB |      5.664 MB |
| SQLite file, including identical 2.703 MB seed                   |        23.343 MB |      8.188 MB |

Memory comparisons used identical production client code, fresh cloned homes and fresh
server processes for each sample. They compare the full fetched data with the 1 MiB
inline-patch budget; they do not compare a failed initial load with a successful one.
The unbounded payload was obtained after making classification succeed. Two untraced
cached Overview samples took 4.75–4.76 s with that payload and 3.74–3.76 s with the
budget. These are descriptive samples, not a timing confidence interval.

The live cold refresh made **110 calls: 88 GraphQL calls costing 89 points, plus 22 REST
calls**. A live refresh reusing file metadata took **22.5 s**, with 36 PR GraphQL calls
costing 37 points and no REST file-list/classification reads. Its log also includes a
one-point linked-PR poll and the three calls for the first diff's full context.
Cold server RSS at snapshot construction was 296 MB; the subsequent shared-server
refresh reached 478 MB. The merged PR already uses a **30-minute cadence** and no checks
polling. Repeated offline runs reached about 530–600 MB server RSS; the fresh-process
comparison above avoids treating allocator retention across iterations as a payload
comparison.

GitHub supplies **250 commit nodes despite totalCount = 6,755 and hasNextPage = false**.
The existing incomplete-data notice now flags that capped history. Its timeline connection
reports 1,752 total items, but the existing item-type filter yields only **one status
event**. Overview still contains the **709 issue comments, 170 reviews and 417 review
threads**: it renders 16,868 light-DOM elements. All 2,188 file metadata records survive
the patch budget. Deferred additions/deletions load through `pullRequest.diffFile`; a
live check rendered the 22-line added `src/ast_jsc/Cargo.toml`. Deferred placeholders use
file counts and loaded hunks supply comment anchors and highlight cache keys.

## Repeatable baseline

The final production build ran each opt-in case three times after one warm-up. These
are medians and observed ranges, under 4× CPU throttling; they are not confidence intervals.
The Diff case starts on cached Overview and ends after the first diff body paints.
The scroll case starts with that body painted and executes ten wheel inputs, moving
4,800 px in total. Its duration includes the fixed waits between inputs.

| Measurement                           |   Median | Observed range |
| ------------------------------------- | -------: | -------------: |
| `pr.diff/huge`, first diff paint      |  6.084 s |  5.816–6.649 s |
| `pr.scroll/huge`, complete sequence   |  5.541 s |  5.512–5.838 s |
| Scroll long tasks                     |       21 |          19–22 |
| Scroll total blocking time            |  2.983 s |  2.806–3.313 s |
| Estimated missed frames, 60 Hz        |      260 |        253–279 |
| Longest animation-frame gap           | 746.5 ms |     728–830 ms |
| Observed frames with unpainted bodies |        1 |            1–1 |
| Scroll instrumentation time           |  16.5 ms |   15.3–20.5 ms |
| Diff JS heap                          | 266.8 MB | 254.7–267.9 MB |
| Scroll JS heap                        | 289.8 MB | 289.1–289.9 MB |

Missed frames estimate gaps between rAF callbacks; blank frames detect visible deferred
or unpainted diff bodies with IntersectionObserver. Neither is a compositor frame count.
CDP reports 117,169–127,478 nodes after Diff, including shadow DOM and detached nodes;
light-DOM counts stay exactly 77,669. Setup receives 5.668 MB over the WebSocket, followed
by 103,842 bytes while opening Diff (first-file full context and protocol messages).
The scroll measurement receives only a 15-byte pong.

An earlier three-run batch measured Diff at 5.082 s (4.964–5.103 s) and scroll at
5.198 s (5.133–5.206 s). The final batch has the deferred-file correctness fixes;
these separate batches cannot establish the cause of the timing difference. Diff's
17,749,750 calls and nine commits stayed exact. Scroll calls varied by 26 across the
final repetitions, in highlight timers and React scheduling, and one repetition had
a layout shift. This is a measured limitation of the scrolling baseline.

## Client costs for part 2

These are observed costs, not proposed fixes. Profiling traces have React profiler overhead;
the production journey timings below are the baseline.

1. **Mounting the full Diff surface.** 77,669 light-DOM elements, about 267 MB JS heap,
   17.75 million app/library calls, approximately 3.55 s script time and 1.6 s combined
   style/layout in the production first-paint run. The profiling trace attributes
   2.28 s sampled self time to React's render work. Diff retains the Overview DOM.
2. **File-tree layout reads.** The Diff profiling trace attributes 1.09 s forced reflow
   to `@pierre/trees`' scrollbar-gutter measurement and another 126 ms to its focus
   helper. Its tree connects while the large Diff DOM is being committed.
3. **Repeated file/thread scans.** Both `FileCard` and the file-tree comment-count map
   run a predicate 912,396 times (2,188 × 417), for 1,824,792 calls together. The same
   counts recur during the scroll case. The scroll profiling trace also samples
   28 ms in the comment-count callback and 42 ms in FileCard itself.
4. **Overview/editor work.** Budgeted Overview still takes roughly 3.75 s; its trace
   samples 390 ms in ProseMirror state updates, with 372 ms forced reflow, and 207 ms
   in tree-order comparisons. During the Diff scroll trace ProseMirror causes another
   138 ms of forced reflow. RPC JSON decoding sampled 98 ms with the full payload;
   it did not dominate the render costs above.

The live dev sandbox also logged two WebGL-unavailable shader rejections and two
Streamdown image-in-paragraph warnings per load. They did not prevent Overview or
the deferred diff from rendering. The initial Vite visit reloaded once to optimise
new dependencies. The production lab blocks remote media, so it measures neither
remote-image loading nor GPU shader performance.

## Validation and recordings

- The fake gh used to exit before stdout drained, truncating large successful responses.
  It now awaits writes. Replayed output was checked byte-for-byte against a recorded response.
- `record-gh` now uses the actual Diff buttons, fails on unsuccessful visits, and records
  pr-lab #1–#5. Download tokens are redacted. The fixture diff contains updated headers/rate
  health, pr-lab #2's changed body, newly captured requests for #5, and removal of unused
  responses. Existing small-PR queries are unchanged.
- All default journeys completed, with no replay misses, errors or missing measured records.
  An interleaved comparison against the starting commit `fc690c4` confirmed the existing
  budget overruns occur there too. PR #1 had identical DOM counts, WS counts and bytes:
  Overview 1,108 nodes / 4 messages / 55,553 code units; Diff 1,228 / 2 / 1,279. A single
  comparison measured Diff at 113.2 ms before and 112.0 ms after; it is not a significance test.
- The golden seed, default journey definitions, budgets and baseline JSON are unchanged.
  The full typecheck, lint, format and test gate passed before every commit: 312 tests pass,
  three skip, none fail. No new tests were added.

Detailed local artifacts (gitignored):

- [Final three-run baseline](out/2026-10-04T02-08-41-331Z/report.md)
- [Final baseline counters and memory](out/2026-10-04T02-08-41-331Z/runs.ndjson)
- [Live recording/server call timings](out/2026-10-04T01-19-25-018Z/server-huge-record-0.log)
- [Cached payload comparison](out/2026-10-04T01-39-06-673Z/payload.json)
- [Overview full-payload trace](out/2026-10-04T01-39-06-673Z/overview-full.md)
- [Overview budgeted-payload trace](out/2026-10-04T01-39-06-673Z/overview-budget.md)
- [Diff trace](out/2026-10-04T01-41-07-542Z/trace-summary.md)
- [Scroll trace](out/2026-10-04T01-47-05-316Z/trace-summary.md)
- [Small-journey comparison](out/2026-10-04T01-44-14-045Z/report.md)
- [Deferred added file](out/huge-investigation/deferred-file.png)

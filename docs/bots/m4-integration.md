# M4 integration record · 9 October 2026

Integration on `bots/m4`, without commits. Only Claude bots were exercised. All live
servers used temporary homes and allocated ports, with a fresh committed git project.
The original development servers, real Jetty home and sketchpad were not touched.

## Changes

`server/src/search/embed.ts` skips the model progress callback when both q8 weight
files are already cached. Transformers.js streams cached weights differently when
that callback is present, adding roughly 250 MB to RSS. Downloads retain progress
reporting. No model, dtype, threading, ranking, prompt, tool description or pinned
error text changed. No client changes or new tests.

A temporary SDK-init log captured real loaded tool lists; it was removed. Temporary
RSS preload and test runtime tracing live only under `/private/tmp/m4-int`.

## Acceptance checks

| Check               | Sonnet 5.5 result and evidence                                                                                                                                                                                                                                                                                          | Opus 5.5                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Tools and prompt | Passed. Init lists both searches; workers and Jett's own thread list neither. No ToolSearch or search approval. Full-access and Auto bots searched. Generated lookups has the exact restored first bullet. Pinned descriptions and metadata pass MCP tests.                                                             | Passed loaded tools and Full access; workers have neither.                         |
| 2. First download   | Passed download and reuse. Empty model cache, real download after unblocking Hugging Face, then successful searches. Cached weights reused by a fresh real bot after server restart. Same-conversation restart is separately blocked below.                                                                             | Not requested.                                                                     |
| 3. Wiki recall      | Passed. Bot wrote Thursday/exam-prep/AZURITE-842, then search ranked `pages/release-process.md:6-14` first and answered correctly.                                                                                                                                                                                      | Passed Tuesday/telescope-maintenance/QUARTZ-551, `pages/releases.md:6-10` first.   |
| 4. Thread recall    | Passed tool/result and reply. Real Obsidian worker, title and author `Obsidian investigation`, `Thu, 8 Oct 2026, 23:58`, proper `jetty://threads/<id>` link. Archived hit includes `archived: true`. Browser navigation blocked.                                                                                        | Passed Quartz worker, author/date/link, also archived. Browser navigation blocked. |
| 5. Incremental      | Passed. Repeated calls embedded zero. Bot changed only release page: `embedded=1 unchanged=3`, then `embedded=0 unchanged=4`. New worker turn indexed only new message IDs. Reopened persisted service/model embedded no old wiki files or messages; two newly completed chat messages caught up, repeat embedded zero. | Not requested.                                                                     |
| 6. Scope            | Passed. Two bots plus real workers and bot-less Jett thread; foreign codes absent from hits. SQL audit found zero foreign, private, report or Jetty-note IDs in all three indexes. Archived workers searchable.                                                                                                         | Extra index audit passed.                                                          |
| 7. Process          | Passed. Real-agent idle exit at 290–300 seconds; fresh child after idle; both SIGINT and SIGKILL left no search child.                                                                                                                                                                                                  | Not requested.                                                                     |
| 8. Parallel         | Passed. Both tools called in one response and succeeded; lifecycle transcript also records simultaneous starts.                                                                                                                                                                                                         | Passed both tools in one response.                                                 |
| 9. Not ready        | Passed. Local CONNECT proxy rejected Hugging Face while allowing Claude. Search returned exact pinned error with `isError` behavior; bot read its page and answered. Removing host block let next search download and answer, without product test paths.                                                               | Not requested.                                                                     |
| 10. Chat            | Browser blocked by macOS sandbox. Tool hiding/working state and entity-link routing checked in existing code and gate tests; no visual result claimed.                                                                                                                                                                  | Same limitation.                                                                   |
| 11. Gates           | Typecheck, lint, format check, and tests green: 460 pass, 3 existing skips, 0 fail. Runtime tracing of test suite: zero search child starts and zero model-host requests.                                                                                                                                               | Shared gates.                                                                      |

## Memory

Measured each process with its own `process.memoryUsage().rss`; sandbox rejects `ps`.
Same CPU q8 model, Mars self-check, one markdown page, same release-day query:

- Recall: 1.680–1.706 GB (decimal bytes); approximately 69 MB before loading.
- Port before fix: 1.942 GB.
- Exact recall embedder with repo dependencies: about 1.708 GB; dependency tree is
  not the cause. Transformers 4.3.1 and ONNX Runtime 1.30.0 match, with identical
  native-library hashes and identical ranking scores.
- Adding only a model progress callback to that reference: 1.950 GB. Tokenizer
  progress alone stayed around 1.68 GB.
- Port after fix: 1.693 GB, matching recall. Child in live server: about 1.691 GB;
  server about 162 MB before search and 169 MB after, not a model-sized increase.

The 410 MB build-note estimate is wrong for this runtime. Quantized weight size
(309 MB on disk) excludes ONNX execution allocations, intermediate activations and
runtime memory arenas. No runtime tuning was introduced. An uncached download
still uses progress, and may show the higher transient RSS until that child exits.

## Process lifecycle

One search child served the initial three real bots (PID 99623). A separate
real-Sonnet run reused the downloaded weights after server restart, with no
proxy or network download. Child 17220 was alive at 290 seconds, gone at 300.
The next real search started child 28359 and embedded zero existing wiki files.
SIGINT of server 16456 left child 28359 gone. A fresh server 29161 searched with
child 30506; SIGKILL left that child gone within three seconds. Own-PID existence
checks returned ESRCH. Server RSS remained around 162–174 MB.

All harnesses, servers, search children, Vite and the failed browser have stopped.

## Restart resume

An existing bot with unchanged project failed after server restart:
`No conversation found with session ID: 76ce2aa8-8e2e-4cc1-ba94-64b0c2196e61`.
A separate bot on clean-cloned `main` (`9ba1e623`) reproduced it:
`No conversation found with session ID: ee6b3d63-bb86-4572-9cd0-099fd50b803d`.

Repro: add the temporary project before creating the Sonnet bot, send a memorable
code, stop server, restart same home, ask for that code. Both turns before restart
succeed; first resumed turn fails. No corresponding new session directory exists
under `~/.claude/projects`. That path is outside sandbox write roots, consistent
with Claude being unable to persist sessions. This is not caused by M4, so shared
resume code was left unchanged. Search-index restart was verified independently
against the actual persisted live bot store and real model, without fake agents.

## Browser limitation

Playwright launched only `chromium_headless_shell-1243` with
`--use-mock-keychain --password-store=basic`. It exited with SIGTRAP:
`bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied (1100)`.
Vite ran against the isolated server. Browser startup failed before any page, so
`/private/tmp/m4-int/shots/` has no screenshots and no screenshot inspection or
actual link click is claimed. Browser exit and temporary-profile cleanup completed.

## Evidence

Preserved under `/private/tmp/m4-int/`:

- `session-tool-lists.json`: real bot, worker and ordinary-thread init tool lists,
  concrete Sonnet/Opus/Haiku 5.5 model names and permission modes.
- `search-tool-evidence.jsonl`: deduplicated real search inputs, outputs, status,
  timestamps and originating transcript artifact. Full per-turn JSON snapshots
  (`sonnet-*`, `opus-*`, `incremental-*`, `scope-exclusions`) remain alongside it.
- `stderr.log`: initial real model self-check and incremental index count lines.
- `scope-audit.json`: message-ID audit against actual live transcripts and indexes.
- `memory*.log`, `port-memory*.log`, `reference-*.log`, `recall-portdeps.log`:
  matched memory comparison and callback isolation.
- `network.log`, `network/`, `network-fixed.log`, `network-fixed/`: proxy requests,
  bot fallback, real download, cache use and restart failure; fixed-code rerun.
- `index-restart.log`: reopened real indexes, unchanged wiki, new-only message
  catch-up and zero-embedding repeated thread search.
- `main-resume.log`, `main-resume/`: independent non-M4 restart repro.
- `clone.log`, `install.log`, `clean-load.log`: clean install and native q8 load.
- `browser.log`: complete native browser startup failure.
- `lifecycle.log`, `lifecycle-*-stderr.log`, `lifecycle-*.json`: real-agent child
  lifecycle, server RSS and transcript evidence.
- `typecheck.log`, `lint.log`, `format.log`, `tests.log`, `tests-audited.log`,
  `test-runtime-audit.jsonl`: gates and spawn/fetch tracing.

## Decisions made for Jett

- Used allocated local ports and deterministic sentinel facts to make evidence
  attributable; let the real bots choose workers and responses.
- Simulated model-host outage with an external local proxy rather than modifying
  product behavior; Claude's API remained reachable so fallback could be observed.
- Kept download progress only where weights are missing, using the model's existing
  pinned q8 filenames to recognize cached weights. No runtime tuning.
- Used process self-reported RSS and own-PID existence checks because `ps` is blocked.
- Left same-conversation restart failure unchanged after reproducing it on `main`.
- Reported browser checks as blocked after the native sandbox rejection; no browser
  substitute or fabricated screenshot.

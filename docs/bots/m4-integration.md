# M4 integration record

Updated 16 October 2026 for keyword search. The original 9 October model-based
integration record is preserved in git history. Its download, self-check, memory
and child-process results apply only to that earlier implementation.

Current search is in-process BM25 over wiki chunks and thread message chunks.
It matches whole words and prefixes case-insensitively. Bots should try a few
wordings with specific terms; related meanings alone do not match. Equal thread
scores prefer recent messages. Search no longer downloads or loads a model.

The benchmark uses a scratch home, the echo agent, one bot and 30 workers with
300 messages each. Most workers then receive new messages. It compares changed
and immediately repeated thread/wiki calls against the original implementation,
and inspects exact, uppercase, partial and absent-term queries. Timings, sample
hits and limitations are recorded at
`~/code/scratch/jetty-overnight/search/report.md`.

Unchanged threads skip item reads. Changed threads use events after their cursor
to read affected items; initial indexing and legacy snapshots can read full
state. Search caches rebuild under a new filename rather than migrating. Current
assistant author names come from thread metadata, without full-state hit reads.

Existing search tests cover incremental wiki indexing, persisted thread cursors,
scope exclusion and searchable message filtering. Existing MCP tests pin the
keyword descriptions and bot-only registration. No new tests were added. The
worktree verification runs typecheck, lint, format and the existing test suite.

No provider-backed bot or browser pass is part of this change. Historical UI
navigation and provider-session limitations in the original record are not
retested by a keyword-search benchmark.

# M4 server build record

Updated for keyword search on 16 October 2026. The original model-based build
record remains in git history; its model, memory, readiness and child-process
checks no longer describe the implementation.

Both bot tools now run in-process using BM25, with case-insensitive whole-word
and lower-weight prefix matches. Callers should try a few wordings with specific
terms. Zero-score results are omitted. Equal thread scores prefer newer messages;
wiki ties prefer recently modified files, then path and line. Scores are squashed and rounded to three places.

Search caches use `JETTY_HOME/search/<botId>.keyword-v1.sqlite`. A filename
version change rebuilds the cache instead of migrating it. Wiki hashes avoid
rewriting unchanged files. Thread cursors identify changed items from the event
log; initial indexing and old unsplit snapshots can require a full-state read.
Changed messages replace cached chunks, including removal when they become
ineligible. Author-kind metadata avoids loading hit threads just to name authors.

Scope, bot-only registration, default k, query limits, current-turn exclusions,
links and stamp formatting remain the same. Both searches serialize per bot.
The model runtime and its dependencies, vectors, downloads, self-check and search
IPC lifecycle are removed. Search has no model-host network requirement.

Existing tests were adjusted for the keyword-only API and descriptions. No new
tests were added. See `m4-integration.md` for current verification and limitations.

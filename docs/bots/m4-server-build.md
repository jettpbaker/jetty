# M4 server build record

Implemented the complete Server checklist in `m4.md`: recall port and pinned tests;
Transformers dependency and trusted install scripts; shared lazy child with CPU q8 model,
Mars self-check, request serialization, five-minute idle exit and parent-disconnect exit;
60-second readiness deadline and pinned tool errors; per-bot WAL SQLite indexes;
bot-only wiki and thread tools; approval-free, always-loaded registration; incremental
file hashes, persistent message IDs and sequence cursors; scope, author and date formatting.
No client work, prompt changes, shared contract changes or commits.

## Verification

- Typecheck, lint, format check and the full test suite pass: 460 passing tests,
  three existing skips, zero failures. Tests use fake embeddings; no model imports,
  downloads or search children occur in the suite.
- Dependency install succeeded using writable temporary/cache locations:
  `BUN_TMPDIR=/private/tmp TMPDIR=/private/tmp bun install --cache-dir /private/tmp/m4-bun-cache`.
  The default locations were not writable in this sandbox. A separate clean-clone
  install was not performed.
- Isolated servers used dynamically allocated ports and temporary homes only.
  Sonnet 5.5 wrote the Thursday/exam-prep fact and searched it later; the top hit
  was `pages/release-process.md:6-12`, including confirmation code ZEPPHIR-842.
- A real Sonnet worker returned OBSIDIAN-947. A second bot searched it and got
  the archived `Obsidian investigation` worker first, with its author,
  `Thu, 8 Oct 2026, 23:47` date and `jetty://threads/<id>` link. Multiple search
  calls in the same bot turn succeeded. Bot-only registration, default k=5,
  exact descriptions and always-load metadata are covered by MCP tests;
  raw Claude session initialization tool lists were not retained.
- Real-model child checks logged unchanged wiki passes embedding zero files,
  an edit embedding one file, incremental thread passes, and persisted indexes
  surviving a child restart. An idle wait of 310 seconds caused the next search
  to start a new model child and embed zero existing files.
- A fresh empty models directory downloaded real weights into the temporary
  home. Restart reused them and embedded zero existing files. A separate slow
  IPC loader simulation exercised the unmodified client's 60-second deadline:
  60.004 seconds, `its model is still downloading (45% of 316 MB)`, then a later
  request succeeded. This simulation substituted the child entry, not the bot.
  Direct MCP calls with simulated readiness/download errors verified both exact
  pinned fallback texts and `isError: true`.
- Reopening the isolated server's persisted store and indexes embedded zero wiki
  files, retained all previously indexed thread messages, and caught up only the
  bot's final reply. A repeated thread search embedded zero messages; adding one
  completed worker message embedded exactly that message.
- SIGKILL of an isolated server left no model child (checked by its recorded PID).
  Normal shutdown and explicit child stop also completed. Server RSS was about
  142–162 MB; child RSS was about **1.93–1.96 GB**, substantially above the spec's
  approximately 410 MB estimate. The model remained entirely in the child.

Not checked: an Opus pass, visual link navigation (M4 has no UI changes), a full
network outage/recovery run, and a real Claude conversation resumed after server
restart. The latter hit the existing CLI's “No conversation found with session ID”
when project instructions changed; fresh bots with their project set at creation
worked. Process/index restart checks are independent of that CLI limitation.

## Implementation decisions

- Thread messages use recall's prose chunker directly, without treating message
  text as page frontmatter. Title and `From {author}, {date}` are embedding context
  only; returned snippets retain message text.
- Thread score ties use embedding similarity, then thread ID and message ID,
  corresponding to recall's deterministic path tie-break. Both tools round the
  returned score to three decimal places.
- Child cursors include indexed message IDs, allowing the server to transmit only
  newly eligible messages when a thread changes; unchanged sequences skip state
  loads. Cursors survive restart and reset when the embedder changes.
- Root entries and root directories are checked for symlinks too, enforcing the
  slice's explicit no-symlinks rule (the reference walker only skipped symlinks
  encountered within its recursive directory walk).
- Download progress includes both the ONNX graph and its external weight data;
  percentages use the pinned 316 MB size. Failed model loads terminate that child
  so the next search can retry; readiness timeouts leave the download running.
- The real embedder validates the required 768 dimensions. No threading/model
  tuning was added to chase the lower memory estimate: recall's runtime settings
  were retained.

All introduced processes were stopped. Test homes and logs remain under
`/private/tmp/m4-*` for the forwarder's review.

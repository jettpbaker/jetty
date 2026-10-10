# Claude session capture

`ClaudeOptions.capture` is an internal, off-by-default observer. Production server startup does not enable it. It records the existing SDK iterator, actual `translate()` results and publication candidates before persistence/coalescing; it does not create another normalizer or renderer.

## The authorized demo

The automated demo runner is deliberately scoped to `~/code/scratch/cloudlets` and the existing `~/.local/bin/claude`. It launches a **real, potentially paid** Claude Code session, not a mocked provider. Do not invoke it without explicit approval for that run:

```sh
bun server/src/claude-capture-demo.ts --run-approved-demo
```

The runner requests `claude-opus-5-5`, High effort, one Jetty user turn, at most 20 SDK rounds, a five-minute abort deadline and a $5 SDK estimated-budget cap. The cap is not a hard billing guarantee. It refuses a different observed model/effort, records applied effort from init/tool hooks when exposed, and never substitutes another model or retries a failed session.

Read/search is limited to six explicitly named regular project files. Edits are limited to `src/index.ts` and `src/sandbox.ts`, with byte baselines and an expected-content ledger. Pre-tool hooks enforce the scope even when SDK permissions would automatically allow a tool. Only Read/Glob/Grep/Edit/Write are offered; no shell commands, scripts, installs, external MCP integrations or secret files are allowed. Claude explores, edits each target, inspects and reverses its own changes. After close, the runner verifies all six files byte-for-byte and only restores attributable expected edits; unexpected concurrent changes are not overwritten. Cloudlets need not have Git; no Git repository is created.

Jetty's temporary SQLite store and all capture artifacts live in a mode-0700 directory beneath `~/.capy/work/JETT-25/`. No app listener starts; the live Jetty database/server and project checkout are untouched. The CLI uses existing authentication internally; the runner does not inspect credentials/settings, and its injected Query skips Jetty's account-usage identity read. SDK filesystem settings/MCP configuration are isolated, and CLI stderr is discarded rather than harvested.

Files are private (0600): `baseline/`, `baseline.json`, `session.tape.ndjson`, `session.viewer.json`, `session.manifest.json`. The console prints only aggregate outcome, restoration, model/tool counts and SDK estimated usage/cost. The viewer and manifest are **unreviewed local data**, not permission to publish. No automatic upload, repository fixture, deletion or live arming control exists. Perform local privacy review before handing a minimal projection to the local playback view; never commit the tape, project contents, thinking or tool payloads. Another real run requires another explicit approval.

## Tape contract

Each line is `{v:1, seq, atMs, kind, data}`. Header data carries the wall anchor, process-local clock segment, SDK/Bun/normalizer versions, thread/scenario identity and fidelity (`synthetic` or `server-observed`). Actual selected CLI version comes from a reduced observed init. The runner also records its effective allowlisted query options separately from the adapter's turn context.

`atMs` is a monotonic recording-relative offset sampled synchronously at SDK iterator receipt or pre-persistence publication. SDK buffering, scheduling and prior downstream processing may delay iterator admission. These are **not provider-generation or browser timestamps**. Wall time is diagnostic only; replay must use saved offsets, never time since loading the file.

| Kind          | Data                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `source`      | `sourceSeq`, admission `turnId`, approved original `message`, or an explicit exclusion marker. Partial/block/complete/result envelopes retain nested IDs and payloads. Init excludes auth/config/plugin fields; unsupported kinds are not silently represented as captured payloads. |
| `translation` | `sourceSeq`, processing `turnId`, actual `events` array, including empty arrays. These precede local workflow/interruption adjustments.                                                                                                                                              |
| `output`      | `sourceSeq:number                                                                                                                                                                                                                                                                    | null`, `turnId`, actual outgoing `event`. Null identifies a local permission/poller/lifecycle cause; source identity is passed explicitly rather than inferred from a global last-message variable. |
| `lifecycle`   | `turnId`, `name`, scoped context: turn/context reset/options, accepted interruption, stream end/failure, permissions/tool timing and close.                                                                                                                                          |
| `gap`         | `firstSeq`, `lastSeq`, categorical `reason` for dropped/unwritten records.                                                                                                                                                                                                           |
| `footer`      | `complete`, `incompleteReason`, `sourceCount`, prefix `writtenRecords`. The status includes the footer write after successful drain.                                                                                                                                                 |

The source policy is explicit in the header. Original text/thinking/tool payloads can be sensitive even when the task is artificial. Recorded IDs and item timestamps preserve actual normalization allocations; raw re-normalization still needs controlled ID/time allocation and asynchronous context, which this recorder does not implement.

One ordered async writer holds immutable serialized records. Its default limits are 4 MiB queued bytes, 2 MiB per record and 64 MiB accepted tape; serialization has transient memory/CPU cost. A limit stops accepting payloads and writes a reserved gap/footer after draining the admitted prefix. A serialization/write failure marks incomplete without failing the agent turn. A failed filesystem may also prevent writing the footer: use the returned status/manifest, never infer completeness from EOF. The two small terminal records are outside the accepted-payload limit.

Result/session-close boundaries drain admitted data; explicit capture stop finalizes it. A known interruption is recorded only after the adapter accepts it under its publication semaphore while awaiting a result, separately from missing capture. Deadline/budget/missing-result captures are labelled incomplete. Abrupt process loss can truncate the final line or lose queued bytes/footer; there is no fsync/crash-durability guarantee. A new run has a new clock segment.

## Presentation handoff

JETT-24's existing loader consumes `{id,title,fidelity,durationMs,capture,inputs:[{seq,atMs,event}]}` with contiguous 1-based viewer sequence. Equal offsets retain sequence order. For a reviewed real capture, use `fidelity:'server-observed'`; synthetic edge cases remain `synthetic`. The adjacent manifest maps viewer sequence to tape sequence/source sequence. A local effective interruption can be mapped to `{type:'local.turn.interrupted',turnId}` after confirming its terminal outcome, never from EOF alone.

The runner's `session.viewer.json` preserves actual normalized events, not tool execution commands. The playback loader/engine is owned by the client; this capture code does not fork it. A local assistant-only privacy projection can retain recorded timing while removing reasoning/tool/permission/context data and redacting paths. Such a projection must declare what it omitted; it does not make the raw tape public-safe.

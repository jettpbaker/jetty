# chunk 8 — image paste

Paste or drop a screenshot into the composer, Claude sees it. The contracts
chunk already reserved every seam: `turn.start` accepts optional
`attachments: UploadAttachment[]` (max `MAX_IMAGES_PER_TURN = 8`), and
user-message items carry metadata-only `Attachment`s ({id, name, mimeType,
sizeBytes} — no bytes, so the event log, IDB cache, and timeline stay light).
What's missing is everything between those types.

## verified API limits (platform.claude.com/docs vision, 2026-07)

- Formats: JPEG, PNG, GIF, WebP. Animations: first frame only.
- 10 MB max per image (base64) on the direct API; 8000×8000 px hard cap.
- Two resolution tiers, server-side downscale above them: **high-res** (Fable 5,
  Opus 4.8/4.7, Sonnet 5) = 2576 px long edge; **standard** (haiku etc.) =
  1568 px. Cost is ⌈w/28⌉×⌈h/28⌉ visual tokens after downscale.
- Docs explicitly recommend pre-resizing client-side; image-before-text block
  order performs best.

## client

- Composer: ai-elements `PromptInput` already has the attachments machinery —
  drag-drop lands in `add(files)`, previews render via `PromptInputAttachments`,
  and submit delivers `message.files` as data URLs. Add a paste handler on the
  textarea (clipboard files → the same `add()`), surface the attachments strip
  + the existing attach button in our `Composer`, and cap at 8 with a toast
  past the limit.
- NO client-side downscale (decision: Jett, 2026-07 — daily models are
  Fable/Opus, high-res tier; Anthropic's server-side resize handles tier
  fitting, and re-encoding risks screenshot text legibility). Bytes pass
  through untouched. The only client checks are the hard API caps: > 10 MB
  or > 8000 px on a side → toast, attachment refused.
- Send path: files → cap check → `UploadAttachment[]` → `turn.start` params.
  Applies to both the draft first-turn path (`sendFirstTurn`) and the
  in-thread composer; steering with images works too (same params).
- Timeline: user bubble renders attachment thumbnails via
  `<img src={'/attachments/' + a.id}>` (below, server serves them). Metadata
  came on the item; bytes come over HTTP on demand — reloads keep thumbnails
  without bloating the persisted state.

## server

- `turn.start` handler threads `attachments` through to the orchestrator.
- Orchestrator: decode each data URL, write to `<data-dir>/attachments/<id>`
  (sibling of the sqlite file; id = `newId()`, extension from mime), build the
  metadata `Attachment` for the user item, and hand the raw blocks to the
  agent. Both paths — fresh turn and steer — replace their hardcoded
  `attachments: []`.
- Claude adapter: `queue.push` grows a content-blocks form — message content
  becomes `[...image blocks (base64), {type:'text'}]`, images first per docs.
  Titler unchanged (text only).
- Static route `GET /attachments/<id>` in main.ts serving the attachments dir,
  same traversal guard as the dist serving.
- Validation: zod already caps count; server rejects a decoded image > 10 MB
  with `invalid_params` (belt-and-braces — the client downscale should make
  this unreachable).

## decisions (Jett, 2026-07)

- No client downscale — send full-fidelity images; hard API caps only.
- Thumbnails over HTTP from the server's attachments dir.

## build order

Parallel (disjoint files):
1. **server** (grok): turn.start→orchestrator threading, attachment
   persistence, content-block queue, static route, shared `MAX_IMAGE_BYTES`
   constant, tests (turn.start with attachments writes files + metadata;
   oversized rejected; content blocks reach the fake agent).
2. **ui** (opus): paste handler, cap checks, composer strip, thumbnails.

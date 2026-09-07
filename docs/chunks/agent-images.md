# agent-sent images — design note

Status: **built, awaiting Jett's confirmation.** Delete this note once confirmed.

## What

The agent can show the user images — mostly verification screenshots of UI it
just changed. One tool call carries 1–4 images and renders inline in the thread
as a gallery; clicking an image opens the same preview dialog the composer's
attachment fan uses.

## Shape

- **Tool**: an in-process SDK MCP server named `jetty` with one tool,
  `send_images({ paths: string[] (1–4), caption?: string })`. Claude sees it as
  `mcp__jetty__send_images`. Paths are absolute or relative to the project
  root. Registered per warm session in `claude.ts` via `options.mcpServers`;
  auto-allowed (`allowedTools` + an early return in `canUseTool`) because it
  only copies files into jetty's own attachments store.
- **Storage**: `attachments.persistFile(path)` copies the source into
  `~/.jetty/attachments/<uuidv7>.<ext>` — same id scheme and `/attachments/:id`
  route as user uploads, same 10 MB cap and png/jpg/gif/webp allow-list. The
  source file can be deleted afterwards; the timeline keeps rendering.
- **Item**: new `ThreadItem` kind `image_gallery` — `images: Attachment[]`
  (1–4), optional `caption`. Emitted by the tool handler (`item.started` +
  `item.completed`) mid-turn, so it lands between the surrounding assistant
  text in order. Reducer needs nothing new; IndexedDB cache validates via the
  shared schema.
- **Hidden tool row**: `claude-translate.ts` drops the `tool_use`/`tool_result`
  for this tool — the gallery is its visible record, a JSON tool row would be a
  duplicate. On failure (bad path, wrong type, too large) the tool returns
  `isError` text to Claude, which reports it in prose; nothing else renders.
- **UI**: `ImageGallery` in `timeline-item.tsx`; 1 image at natural size
  (capped), 2/3/4 as a grid of uniform `object-contain` tiles (screenshots must
  not be cropped). `ImagePreviewDialog` is extracted from `attachment-fan.tsx`
  and shared. Default shadcn styling; the design pass owns the rest.

## Taste calls made without Jett (flag any you'd change)

1. Hide the tool row rather than register it in the tool-row registry.
2. Gallery cap at 4 (shared `MAX_GALLERY_IMAGES`).
3. `object-contain` tiles with a `4:3` frame, not `object-cover`.
4. Sent user-message thumbnails still open in a new tab; only agent images got
   the dialog (out of scope, easy follow-up to reuse `ImagePreviewDialog`).
5. No keyboard prev/next inside the dialog.

# chunk 5 — draft-first thread creation

Threads stop being born empty. The "new thread" surface becomes a draft: a
composer with no thread behind it, and the thread only comes into existence on
first send. Stolen from opencode (recon notes in chunks.md), adapted to our
decision: client-minted ids, so the draft→thread transition has no intermediate
state at all.

## the flow

1. Sidebar "+" (or new-project success) navigates to the draft route for that
   project. The page is just a composer — no timeline, no thread.
2. On submit: mint `threadId = newId()` client-side and navigate to
   `/thread/$threadId` immediately — pixels first, the real URL from frame one.
3. Behind the navigation, strictly sequenced: `thread.create { id, projectId }`
   → on success, re-`openThread(threadId)` (subscribes now that the thread
   exists) → `turn.start { threadId, text }`. Subscription lands before any
   events exist, so nothing is ever missed; `afterSeq` catch-up covers races
   anyway.
4. The composer does NOT clear until `turn.start` resolves. That's our
   anti-vanish mechanism instead of an optimistic timeline item: your text stays
   visibly in the composer for the ~two round trips until the real user item
   streams in, then clears. No provisional items, no reconciliation.
5. Failure (create or start rejects): stay put, text still in the composer,
   visible error. Retry is just pressing send again — create is idempotent.

## wire + server changes (small)

- `thread.create` params gain a **required** `id` — the client owns id minting,
  full stop; the server never mints thread ids again. Server adopts it: if a
  thread with that id exists and the projectId matches, return it unchanged
  (idempotent, retry-safe); mismatched projectId → `invalid_params`.
- `store.createThread(projectId, id)` accordingly — no conditional mint path.
  Server tests and fixtures mint their own ids via the shared `newId()`.
  Everything else — events,
  turn.start, titler — is untouched; the titler fires exactly as before since
  the thread is created with the default title an instant before its first turn.

## client changes

- New route `/new/$projectId` → the draft page: `NewSessionDesignView`-ish
  minimal shell, the same `PromptInput` composer, no timeline store involvement.
- Draft text persists per project (localStorage, tiny helper in `lib/`) —
  survive reloads mid-thought; cleared on successful send. Keyed by projectId,
  not a draftId: one draft per project is enough until tabs exist, and upgrading
  the key to draftIds later is mechanical.
- Sidebar "+" stops calling `thread.create`; it just navigates. The dialog's
  create-project success navigates to the new project's draft.
- Empty threads can no longer be created from the UI.

## decisions (Jett, 2026-07)

- **Home (`/`)**: keep the "pick a thread" empty state for now.
- **Failure surface**: `sonner` toast — install it this chunk (it becomes the
  archive-undo vehicle in chunk 6).
- **Composer-clear timing**: clear on confirm, no optimistic timeline item.

## build order

1. **server** (grok): wire schema, store adopt-id, ws handler, tests (idempotent
   re-create, projectId mismatch, adopt + turn.start sequence).
2. **ui** (opus): draft route + page, sidebar/dialog rewiring, draft
   persistence, failure surface per the answers above.

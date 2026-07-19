# approval dock

The approvals redesign, informed by the opencode recon (opus agent, 2026-07-19).
opencode's editorial rule: **the card asks, the transcript shows** — their desktop
app pins the approval as a dock above the composer and keeps no transcript record.
We adopt the dock, but deviate on history: our wire already persists approval
items with decisions, so the timeline keeps a slim resolved row. Their model,
plus the record they chose not to keep.

## model

- **Dock asks.** When `status === 'awaiting_approval'`, the composer is replaced
  (hard block, opencode-style) by an `ApprovalDock`: the item's `title`, the
  meaningful line via the tool-row field renderer (mono `$ command`, split path —
  our rows are one-liners, so the dock carries the detail like opencode's TUI),
  and the actions.
- **Timeline shows.** The approval item renders as a slim row, tool-row language,
  never a card: pending → muted "Awaiting approval" + field (non-interactive; the
  dock is the only place to act); resolved → "Approved" / "Denied" + field.
- **Deny can steer.** Deny offers an optional message ("tell it what to do
  differently") — cheap on web, opencode gates it to subagents; we don't.

## interactions

- Allow = primary, autofocused. Deny = ghost. Enter allows, Esc denies
  (keyboard activation standard; act-on-press for pointer).
- Buttons disable while `approval.respond` is in flight; toast + re-enable on error.
- No timeout — prompts wait.

## wire

- v1 needs **one addition**: optional `message` on `approval.respond`, patched
  onto the item (`deniedReason`) and passed through as the SDK deny message so
  the model actually sees it. Everything else exists: item carries
  title/toolName/input/suggestions, decision patches via `item.completed`,
  `awaiting_approval` status drives dock visibility.
- **Always-allow: deferred.** `suggestions` already crosses the wire but a real
  "always" needs the honest two-stage pattern preview + server-side rule
  persistence that doesn't exist yet. Follow-up chunk, not this one.

## build list

- `client/src/components/approval-dock.tsx` — dock, rendered by the thread route
  in the composer slot while awaiting approval.
- `timeline-item.tsx` — approval case → slim row (delete `ApprovalCard`).
- `shared` + `server` — `approval.respond` message param, deny passthrough,
  `deniedReason` patch.
- Styleguide: dock states section (pending / responding / deny-with-message
  open); sheet approval entries become the slim rows; the tape's approval beat
  exercises the dock in the rig via the thread-route composer slot stand-in.

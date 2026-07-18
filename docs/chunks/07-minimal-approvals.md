# chunk 7 — minimal approvals

Unblock threads that hit a permission prompt. The whole stack below the UI
already works — `canUseTool` pockets the resolve in `pendingApprovals`, the
approval item streams into the timeline, `approval.respond` on the wire fishes
the resolve back out via `orchestrator.respondApproval`, and the item's
`decision` field flows back as an update the card already renders as a badge.
The only missing piece is the client never calls the method.

## the change (client only)

- `timeline-item.tsx`, `approval` case: when `item.decision` is unset, render
  Allow / Deny buttons in the card footer wired to
  `socket.request('approval.respond', { threadId, itemId: item.id, decision })`.
  Once the decision push lands, `item.decision` is set and the buttons give way
  to the existing badge — server state drives the UI, no local bookkeeping.
- `threadId` isn't on the item, so `Timeline` passes it down as a prop
  (stable per thread; doesn't disturb the `TimelineItem` memo).
- While the request is in flight: disable both buttons. On error (e.g. the
  approval is no longer pending after a server restart): sonner toast.
- Plain `onClick`, NOT act-on-press — approving a tool call is consequential
  and has no undo, exactly the case AGENTS.md excludes from pointer-down.
- Buttons: default shadcn `Button`, Allow as `default` variant, Deny as
  `outline`. Anything fancier is the design pass's problem (card design,
  attribution, `suggestions` / `updatedPermissions` — all parked there;
  `updatedPermissions` stays unsent in this chunk).

## build

One small opus pass. Test-wise the wiring is too thin to unit-test usefully
client-side (the server path is already covered); real verification is Jett
triggering an approval and clicking through — recipe: in auto mode, ask the
agent to run something the workspace sandbox won't contain (e.g. a network
call to a non-allowlisted host).

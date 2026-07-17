# sheet

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: restructured onto the Base UI Dialog primitive (Overlay→Backdrop, Content→Popup) with per-side slide styles; lucide icon preserved.

## Changed

- `client/src/components/ui/sheet.tsx`: `import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"`. `SheetOverlay` → `Backdrop`; `SheetContent` → `Popup` with `data-[side=…]` slide styling rewritten from the Radix `animate-in/out` idiom to `data-starting-style`/`data-ending-style` transitions per side; close button uses `render={<Button …/>}`. Composes the base `Button` wrapper (registry rdep). Icon stays lucide `XIcon`.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder\|@/registry" sheet.tsx` → nothing.

## Left alone

- Consumed by `sidebar.tsx` (mobile drawer) via the stable `Sheet*` names — no call-site changes needed there.

## Behavior changes

- Enter/exit is transition-based (`data-starting-style`/`data-ending-style`) rather than keyframe `animate-in/out`; visually equivalent slide-in/out per side. `onOpenChange` gains an `eventDetails` arg (handlers unaffected).

## Verify by hand

- On a narrow viewport, open the sidebar's mobile sheet: it slides in from the side, backdrop dims, focus is trapped, and it closes on the X / Esc / outside-press with the slide-out animation.

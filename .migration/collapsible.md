# collapsible

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: direct primitive swap, `Content` → `Panel`.

## Changed

- `client/src/components/ui/collapsible.tsx`: `import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"`. `CollapsibleContent` now renders `CollapsiblePrimitive.Panel`; `Collapsible`/`CollapsibleTrigger` map 1:1. Radix `data-[state=open|closed]` become Base presence attrs (`data-open`/`data-closed` on Panel, `data-panel-open` on Trigger); height var `--radix-collapsible-content-height` → `--collapsible-panel-height` (carried by the registry classes).
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" collapsible.tsx` → nothing.

## Left alone

- Consumers (app-sidebar, sidebar) use `<Collapsible>`/`<CollapsibleTrigger>`/`<CollapsibleContent>` by their stable public names with no `asChild` — nothing to sweep.

## Behavior changes

None functional. Open/close state is now driven by `data-open`/`data-closed` + `data-starting-style`/`data-ending-style` transitions instead of the Radix `data-state` + keyframe idiom (registry-provided classes).

## Verify by hand

- Toggle a collapsible: it expands/collapses with the height animation; keyboard Enter/Space on the trigger works.

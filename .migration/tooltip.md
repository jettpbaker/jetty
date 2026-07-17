# tooltip

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: swapped to the Base UI Tooltip primitive with the Portal→Positioner→Popup model; `delayDuration` → `delay`.

## Changed

- `client/src/components/ui/tooltip.tsx`: `import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"`. `TooltipProvider` renames `delayDuration` → `delay` (default stays `0`). `TooltipContent` is now `Portal > Positioner > Popup`; positioning props are declared, destructured, and forwarded to `Positioner` (defaults `side="top"`, `align="center"`, **`sideOffset=4`**, `alignOffset=0`); Positioner gets `isolate z-50`, Popup keeps `z-50`. `Arrow` uses the base per-side offset/translate classes.
- `client/src/components/ai-elements/message.tsx`: two `<TooltipTrigger asChild>` → `<TooltipTrigger render={…} />` (one wrapping the `{button}` element, one wrapping an attachment `<div>`).
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder"` on both files → nothing.

## Left alone

- `TooltipProvider`/`Tooltip`/`TooltipTrigger` public names unchanged; no consumer used `disableHoverableContent` or `skipDelayDuration`.

## Behavior changes

- `sideOffset` default 0 → 4: tooltips now sit 4px off the trigger instead of flush (base-nova registry default). Open delay is unchanged (both old and new default to `0`, i.e. instant).
- Enter/exit is now transition-based (`data-open`/`data-closed` + `data-starting-style`/`data-ending-style`) rather than the Radix `data-state` keyframe idiom; the registry class string carries both the base hooks and some legacy `data-[state=delayed-open]` classes (kept as-authored by the base-nova registry).

## Verify by hand

- Hover a tooltipped icon button (composer/message actions): the tooltip appears instantly, offset 4px from the trigger, with the arrow correctly placed for top/bottom/left/right sides.

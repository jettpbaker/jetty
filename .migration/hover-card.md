# hover-card

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: renamed onto the Base UI PreviewCard primitive with the Portal→Positioner→Popup model; delays moved from Root to Trigger.

## Changed

- `client/src/components/ui/hover-card.tsx`: `import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"` (public wrapper names stay `HoverCard*`). `HoverCardContent` is now `Portal > Positioner > Popup`; positioning props (`side`/`sideOffset`/`align`/`alignOffset`) are declared, destructured, and forwarded to `Positioner` (defaults `side="bottom"`, `sideOffset=4`, `align="center"`, `alignOffset=4`). Positioner gets `isolate z-50`.
- `client/src/components/ai-elements/prompt-input.tsx`: `PromptInputHoverCard` no longer forwards `openDelay`/`closeDelay` to the Root (the base Root has neither). The instant-hover intent is preserved by setting `delay={0} closeDelay={0}` on the `HoverCardTrigger` at the call site, and that trigger's `asChild` became `render={<div …/>}`.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder"` on both files → nothing.

## Left alone

- `PromptInputHoverCardTrigger`/`PromptInputHoverCardContent` passthrough wrappers keep their shape (only the Root delay handling changed).

## Behavior changes

- Open/close delay: Radix `HoverCard` open delay defaulted to 700ms and lived on the Root; Base UI moves it to the Trigger with a default of 600ms open / 300ms close. Any consumer that does NOT set delays now gets 600/300 instead of 700/300. The one real consumer (prompt-input attachment preview) explicitly sets `delay={0} closeDelay={0}`, so its instant-open/close behavior is unchanged.

## Verify by hand

- Hover an attachment chip in the composer: the preview card opens/closes instantly (no perceptible delay) and is positioned below-start with the arrow-free popup.

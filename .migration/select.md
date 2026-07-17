# select

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: restructured onto the Base UI Select primitive (Content→Positioner/Popup, Viewport→List, scroll buttons→arrows); lucide icons preserved.

## Changed

- `client/src/components/ui/select.tsx`: `import { Select as SelectPrimitive } from "@base-ui/react/select"` (`Select` is a bare `SelectPrimitive.Root` re-export — its `.Props` is generic). Part remap: `Content` → `Portal > Positioner > Popup`; `Viewport` → `List`; `ScrollUpButton`/`ScrollDownButton` → `ScrollUpArrow`/`ScrollDownArrow`; `Label` → `GroupLabel`; `Icon`/`ItemIndicator` use `render`. `position` is replaced by `alignItemWithTrigger` (default `true`) picked from Positioner; defaults `sideOffset=4`, `align="center"`, `alignOffset=0`. Icons stay lucide `CheckIcon`, `ChevronDownIcon`, `ChevronUpIcon`.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder\|@/registry" select.tsx` → nothing.

## Left alone

- The only consumer (`ai-elements/prompt-input.tsx` `PromptInputSelect*`) passes through to the wrappers with no `position` or typed `onValueChange` state, so no call-site edits were needed.

## Behavior changes

- `onValueChange` widens from `(value: string)` to `(value: Value | null, eventDetails)`. No consumer binds a typed `useState<string>` to it, so nothing breaks; a future consumer that does must widen its state to `string | null`.
- `position="popper"|"item-aligned"` no longer exists; the wrapper exposes `alignItemWithTrigger` (default `true` = item-aligned). LATENT: any future consumer wanting popper-mode passes `alignItemWithTrigger={false}`.

## Verify by hand

- Open a Select (e.g. the model picker in the composer if present via prompt-input): items align with the trigger, keyboard typeahead selects, the check mark shows on the selected item, and scroll arrows appear when the list overflows.

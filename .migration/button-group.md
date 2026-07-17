# button-group

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: swapped the Slot/asChild idiom for `useRender` and picked up the base Separator.

## Changed

- `client/src/components/ui/button-group.tsx`: Slot/asChild → `useRender` + `mergeProps` (`@base-ui/react/*`) for the polymorphic group root; imports `Separator` from `@/components/ui/separator` (now the base variant — see separator.md). cva group classes unchanged; `@/lib/utils` alias resolved.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" button-group.tsx` → nothing.

## Left alone

- No `<ButtonGroup asChild>` call sites in the app.

## Behavior changes

None functional. Inherits the separator a11y note (see separator.md) since it composes `Separator`.

## Verify by hand

- A button group renders its children inline with separators between segments; the group orientation/rounding classes still apply.

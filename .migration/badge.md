# badge

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine — matched radix-nova stock modulo oxfmt formatting + utils alias). One-line: rewired the Slot/asChild polymorphism idiom to Base UI's `useRender`.

## Changed

- `client/src/components/ui/badge.tsx`: replaced `import { Slot } from "radix-ui"` + `asChild ? Slot.Root : "span"` with `useRender` (`@base-ui/react/use-render`) + `mergeProps` (`@base-ui/react/merge-props`). `Badge` now takes `useRender.ComponentProps<"span">` and returns `useRender({ defaultTagName: "span", props: mergeProps(...), render, state: { slot: "badge", variant } })`. `badgeVariants` (cva) unchanged; `@/lib/utils` alias resolved.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" badge.tsx` → nothing.

## Left alone

- No related files. No consumer used `<Badge asChild>` (grep of app code + ai-elements), so no call sites changed.

## Behavior changes

None. Polymorphism moves from `asChild`+child to the `render` prop; the default `<span>` render path is unchanged.

## Verify by hand

- A plain `<Badge>` renders a span with the variant classes.
- `<Badge render={<a href="…" />}>` renders an anchor and merges the badge classes/`data-slot` onto it.

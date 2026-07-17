# button

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: `button.tsx` now wraps the real Base UI Button primitive instead of a Slot/asChild wrapper.

## Changed

- `client/src/components/ui/button.tsx`: `import { Button as ButtonPrimitive } from "@base-ui/react/button"`; `Button` props are `ButtonPrimitive.Props & VariantProps<typeof buttonVariants>` and it renders `<ButtonPrimitive data-slot="button" className={…} {...props} />`. The `asChild ? Slot.Root : "button"` branch is gone — the primitive supports polymorphism via `render` natively. `buttonVariants` (cva) unchanged; `@/lib/utils` alias resolved.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" button.tsx` → nothing.

## Left alone

- No consumer used `<Button asChild>` in app code or ai-elements (grep). Nothing to sweep here.

## Behavior changes

None to the button itself. Consumers that previously used `<Button asChild>` would now need `render={…}`, but none exist.

## Verify by hand

- Click each variant/size; disabled buttons are non-interactive.
- `<Button render={<a href="…" />}>` renders an anchor styled as a button.
- The `active:not-aria-[haspopup]:translate-y-px` press affordance still fires on non-menu buttons.

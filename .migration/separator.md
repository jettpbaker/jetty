# separator

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: direct swap to the callable Base UI Separator; the `decorative` prop is gone.

## Changed

- `client/src/components/ui/separator.tsx`: `import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"`; the wrapper renders `<SeparatorPrimitive …>` (callable single part, no `.Root`). The Radix `decorative` prop (which the old wrapper defaulted to `true`) is dropped — Base UI's separator is always semantic (`role="separator"`). `orientation` still forwarded.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" separator.tsx` → nothing.

## Left alone

- No consumer passed `decorative` (grep). `button-group` and `sidebar` compose `Separator` by its public name.

## Behavior changes

- a11y: the old wrapper defaulted `decorative={true}` (rendered `role="none"`/aria-hidden — a purely visual rule). The base separator is always `role="separator"`, so assistive tech now announces these separators. If any given separator should stay purely decorative, render a plain `<div aria-hidden="true">` there instead. No visual change.

## Verify by hand

- Separators still render as thin rules at the same positions (sidebar, button groups). With a screen reader, they now register as separators — confirm that reads acceptably in the sidebar.

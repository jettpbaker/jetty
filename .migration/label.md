# label

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: Base UI has no Label primitive — the wrapper is now a native `<label>`.

## Changed

- `client/src/components/ui/label.tsx`: dropped `import { Label as LabelPrimitive } from "radix-ui"`; `Label` renders a plain `<label data-slot="label" className={cn(…)} {...props} />` typed as `React.ComponentProps<"label">`. The Radix behavior of suppressing double-click text selection is preserved by the `select-none` class already in the registry class string.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" label.tsx` → nothing.

## Left alone

- No consumer used `<Label asChild>`; native `<label htmlFor>` / wrapping association is unchanged.

## Behavior changes

None. Native `<label>` gives the same click-to-focus association; `select-none` covers the one Radix-specific behavior (no text selection on double click).

## Verify by hand

- Clicking a label focuses its associated control; double-clicking the label text does not select it.

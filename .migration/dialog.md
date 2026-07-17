# dialog

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: restructured onto the Base UI Dialog primitive (Overlay→Backdrop, Content→Popup), lucide icon preserved.

## Changed

- `client/src/components/ui/dialog.tsx`: `import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"`. `DialogOverlay` → `DialogPrimitive.Backdrop`; `DialogContent` → `DialogPrimitive.Popup` (centered modal, no Positioner); `DialogClose` uses `render={<Button …/>}` (was `asChild`). Icon stays lucide `XIcon` (icon pack unchanged this pass — see project.md).
- **Wrapper deviation from golden (intentional):** the `Dialog` root wrapper's props are narrowed to `Omit<DialogPrimitive.Root.Props, "children"> & { children?: React.ReactNode }`. Base UI's `Dialog.Root` children is a `ReactNode | payload-render-function` union; `command.tsx`'s `CommandDialog` derives its props via `React.ComponentProps<typeof Dialog>` and passes children into a `ReactNode` slot, which failed to typecheck against the union. Narrowing keeps cmdk's `command.tsx` untouched (hard rule) while staying type-safe. The app does not use Dialog's payload-render children, so no capability is lost.
- `client/src/components/new-project-dialog.tsx`: `<DialogTrigger asChild>` → `<DialogTrigger render={<Button …>New project</Button>} />`.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder\|@/registry"` on both files → nothing.

## Left alone

- `command.tsx` (cmdk — hard rule, never touched); its `CommandDialog` consumes `Dialog` and keeps compiling thanks to the wrapper children-narrowing above.

## Behavior changes

- `onOpenChange` now receives a second `eventDetails` arg; the existing single-arg `setOpen` handler stays type-safe and behaves the same.
- Radix per-interaction dismiss/focus callbacks (`onEscapeKeyDown`, `onPointerDownOutside`, `onOpenAutoFocus`, `onCloseAutoFocus`) are consolidated into `onOpenChange`'s `reason` + `initialFocus`/`finalFocus`. None were used, so no change in practice.

## Verify by hand

- Open the New Project dialog: it centers with the backdrop, traps focus, returns focus to the trigger on close, and dismisses on Esc / outside-press / the X button.
- The command palette (⌘K / CommandDialog) still opens and closes correctly.

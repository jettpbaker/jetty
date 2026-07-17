# dropdown-menu

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: DropdownMenu renamed onto the Base UI Menu primitive with the Portal→Positioner→Popup model; lucide icons preserved.

## Changed

- `client/src/components/ui/dropdown-menu.tsx`: `import { Menu as MenuPrimitive } from "@base-ui/react/menu"`. Part remap: `Content` → `Portal > Positioner > Popup` (side/sideOffset/align/alignOffset hoisted to Positioner, `isolate z-50`); `Label` → `GroupLabel`; `ItemIndicator` → `CheckboxItemIndicator`/`RadioItemIndicator`; `Sub`/`SubTrigger` → `SubmenuRoot`/`SubmenuTrigger` (open marker `data-popup-open`); `SubContent` composed from the content wrapper. Icons stay lucide `CheckIcon`, `ChevronRightIcon`.
- `client/src/components/app-sidebar.tsx`: `<DropdownMenuTrigger asChild>` → `render={<SidebarMenuAction …/>}`.
- `client/src/components/ai-elements/prompt-input.tsx`: `<DropdownMenuTrigger asChild>` → `render={<PromptInputButton …/>}`.
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder\|@/registry"` on all three files → nothing.

## Left alone

- No consumer uses `DropdownMenuCheckboxItem`/`DropdownMenuRadioItem` (grep) — only plain `DropdownMenuItem`, whose `closeOnClick` defaults to `true` (unchanged from Radix's close-on-select).

## Behavior changes

- `onSelect(event)` on items is replaced by `onClick` + `closeOnClick`. Plain `Item` still closes on click (default `true`). LATENT delta: Base UI `CheckboxItem`/`RadioItem` default `closeOnClick={false}` (Radix closed on select) — if checkbox/radio menu items are added later, set `closeOnClick` to keep Radix behavior. Not exercised today.
- `onOpenChange` gains an `eventDetails` arg; existing handlers are unaffected.

## Verify by hand

- Open the thread-actions menu (⋯ in the sidebar) and the prompt-input action menu: keyboard up/down navigation and typeahead work, plain items close the menu on click, and the trigger shows the pressed/open state.

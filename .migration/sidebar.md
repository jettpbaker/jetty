# sidebar

2026-07-17. Golden pair via CLI (base-nova registry variant, wrapper was pristine). One-line: composite wrapper re-based onto Base UI; polymorphic parts moved from `asChild` to `render`; lucide icon preserved. Migrated last (it composes button/input/separator/sheet/skeleton/tooltip).

## Changed

- `client/src/components/ui/sidebar.tsx`: dropped `import { Slot } from "radix-ui"`; polymorphic parts (`SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuSubButton`, etc.) now use Base UI `useRender` + `mergeProps` / the `render` prop instead of `Slot`+`asChild`. Composes the migrated base wrappers `Button`, `Input`, `Separator`, `Sheet`, `Skeleton`, `Tooltip` by their stable public names, plus the existing `@/hooks/use-mobile` hook (registry rdep `use-mobile`, already present — not re-added). Icon stays lucide `PanelLeftIcon`.
- `client/src/components/app-sidebar.tsx`: `<SidebarMenuButton asChild>` → `render={<Link to="/settings">…</Link>}` (and the DropdownMenuTrigger edit noted in dropdown-menu.md).
- Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder\|@/registry"` on both files → nothing.

## Left alone

- `@/hooks/use-mobile.ts` already existed and is not radix — untouched.

## Behavior changes

- Inherits the composed wrappers' deltas: tooltip `sideOffset` 0→4 (see tooltip.md) on the collapsed-rail menu tooltips, and separators are now semantic (see separator.md). No sidebar-specific behavior change; collapse/expand, keyboard, and the mobile sheet behave as before.

## Verify by hand

- Toggle the sidebar rail (collapse/expand) via the trigger and keyboard shortcut; hover a collapsed menu item to see its tooltip (offset 4px); on mobile the sidebar opens as a sheet; the Settings link and per-thread ⋯ menu work.

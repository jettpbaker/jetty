# project: Radix UI → Base UI (whole-project migration)

2026-07-17. Whole-project mode. Client workspace `client/`. shadcn project, style flipped `radix-nova` → `base-nova`. All 13 radix wrappers migrated to `@base-ui/react@1.6.0` via the golden-pair path; every wrapper was **pristine** (matched its radix-nova stock modulo oxfmt formatting + alias rewrite — consistent with AGENTS.md "UI rides default shadcn styles"), so each was replaced wholesale with its base-nova registry variant.

## Dependency swap

- Added `@base-ui/react@1.6.0` to `client/package.json`.
- Removed `radix-ui` and `@radix-ui/react-use-controllable-state` from `client/package.json`. `grep radix client/package.json` → clean.
- `components.json`: `"style": "radix-nova"` → `"base-nova"`. `iconLibrary` left as `lucide` (see icon note). `rsc:false` honored (no `"use client"` added where absent).
- Lockfile (`bun.lock`) still contains transitive `@radix-ui/react-*` entries — these are **cmdk's** dependencies (`cmdk@1.1.1` → react-dialog/compose-refs/id/primitive). cmdk is intentionally untouched (hard rule); its transitive radix is expected and out of scope.

## Wrappers migrated (13)

badge, button (real `@base-ui/react/button` primitive), button-group, collapsible, dialog, dropdown-menu, hover-card, label (native `<label>`), select, separator, sheet, sidebar, tooltip. One report each in this directory. Leftover sweep across all 13: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder\|@/registry"` → zero.

## App-code / consumer sweep

The call-site break surface was small and is fully resolved:

- `asChild` → `render` (6 sites): `ai-elements/message.tsx` ×2 (TooltipTrigger), `ai-elements/prompt-input.tsx` ×2 (HoverCardTrigger, DropdownMenuTrigger), `app-sidebar.tsx` ×2 (DropdownMenuTrigger, SidebarMenuButton), `new-project-dialog.tsx` ×1 (DialogTrigger).
- HoverCard `openDelay`/`closeDelay` (both `0`) relocated from the base Root (which no longer accepts them) onto the trigger as `delay`/`closeDelay` in `prompt-input.tsx`, preserving instant-hover.
- No `delayDuration`/`position=`/`decorative`/`indeterminate`/`onValueChange`(typed-string)/focus-callback issues existed anywhere else in app code.

## Radix utility with no Base UI counterpart (resolved to zero-radix)

`ai-elements/reasoning.tsx` imported `@radix-ui/react-use-controllable-state` (a standalone utility, not a UI primitive; Base UI ships no public equivalent). Replaced with a local `client/src/lib/use-controllable-state.ts` mirroring radix semantics. See `reasoning.md`. Live usage is uncontrolled-only (`timeline-item.tsx` → `<Reasoning defaultOpen={false}>`), so the hook's controlled path is unexercised.

## Intentional deviation from golden

- `dialog.tsx`: the `Dialog` root wrapper's `children` is narrowed to `React.ReactNode` (`Omit<DialogPrimitive.Root.Props, "children"> & { children?: React.ReactNode }`). Base UI `Dialog.Root` children is a `ReactNode | payload-render-fn` union; cmdk's `command.tsx` `CommandDialog` derives props via `ComponentProps<typeof Dialog>` and would not typecheck against the union. Narrowing keeps `command.tsx` untouched (hard rule) with no loss (the app doesn't use payload-render children). See `dialog.md`.

## Intentionally untouched

- `command.tsx` (cmdk) and `message-scroller.tsx` (`@shadcn/react`) — not radix. Left as-is and building.
- `@/hooks/use-mobile.ts` — sidebar's registry dependency, not radix.

## ICONS — pending separate Phosphor pass (NOT done here, by design)

Per the confirmed plan, this migration keeps **lucide** on all 5 icon-bearing wrappers (dialog `XIcon`, dropdown-menu `Check`/`ChevronRight`, select `Check`/`ChevronDown`/`ChevronUp`, sheet `XIcon`, sidebar `PanelLeft`) so the migration commit stays single-purpose (pure radix→base, reviewable against golden pairs with zero icon deltas). A dedicated **lucide → Phosphor pass runs immediately after this lands as its own atomic commit**, covering the whole tree at once: these 5 wrappers, `message-scroller.tsx`, ai-elements, app code, the `components.json` `iconLibrary` flip, adding `@phosphor-icons/react`, and adding the oxlint `no-restricted-imports` fence for `lucide-react` that AGENTS.md promises (no such rule exists in `.oxlintrc.json` today; `client/src/components/ui/**` and `ai-elements/**` are currently lint-ignored regardless).

**Intel for the next agent (icon pass):** the shadcn registry encodes each icon as an `IconPlaceholder` carrying BOTH a `lucide` and a `phosphor` name (e.g. `<IconPlaceholder lucide="ChevronRightIcon" phosphor="CaretRightIcon" … />`), so registry components can be resolved to either pack deterministically by reading `files[].content` from `https://ui.shadcn.com/r/styles/base-nova/<component>.json` and substituting — the shadcn CLI does this off `components.json` `iconLibrary`. Lucide `Chevron*` → Phosphor `Caret*`, `PanelLeft` → `Sidebar`; `X`/`Check` are the same name in both.

## Verify (all gates green, from repo root)

- `bun run format` (oxfmt): exit 0 (120 files).
- `bun run lint` (oxlint): exit 0, clean.
- `bun run typecheck` (shared + server + client): exit 0.
- `bun test`: 32 pass, 1 skip, 0 fail (run unsandboxed — sandboxed runs hit EADDRINUSE binding port 0 in `Bun.serve`, a sandbox limitation, not a test failure).
- `bun run --filter @jetty/client build`: exit 0 (chunk-size warnings are pre-existing, present in the baseline).

Baseline (captured before any change): typecheck exit 0, build exit 0 — so all green results are attributable to a clean migration, not pre-existing state.

## Remaining radix count

- Direct radix imports in `client/src`: **0**.
- Radix in `client/package.json`: **0**.
- Intentionally-untouched radix: cmdk's transitive `@radix-ui/*` in the lockfile only (via `command.tsx`, a hard-rule library).

## Not done (per brief)

No git commit / branch (commit signing needs the user's hardware key — orchestrator commits). `docs/chunks.md` not ticked.

# working in this repo

## branch strategy

- Active development is on `main`. Fetch it and base new work on `origin/main`.
- Commit directly to `main` — small, frequent commits, no PRs. Parallel agents
  work in their own worktrees/branches, then rebase onto `main` and land as a
  fast-forward once typecheck, lint, format, and tests pass.

## project guidance

- taste decisions — tech choices, UX, naming, API shapes — get checked with Jett
  first, every time. When in doubt, ask.
- This repo is the source of truth for UI. `~/code/scratch/jetty-design` is a
  sketchpad for designing new UI quickly against mock data.
- When bringing a design over from the sketchpad, port it verbatim — same markup,
  classes, primitives, and icons — and change only the data wiring. Never
  re-create something the sketchpad already built, and name any visual deviation
  in the commit message. Once ported, the component lives here; don't backport.
- Before calling ported UI done, compare it against the sketchpad side by side
  (screenshots of both), not just "it works".
- UI with no sketchpad design yet rides default shadcn styles.

## code

- Code should be clean, simple, and concise enough to be self-documenting. Comments
  are for constraints the code can't express, not for narrating what it does.
- If you need a paragraph-long comment to justify why the workaround is OK, the code
  is wrong — fix the code.
- Use `type`, not `interface`.
- Use `for...of`, not `.forEach()`.
- Factory functions over classes. Classes only for `Error` subclasses, when a
  library demands one, or for stateful render engines (e.g. `GlowEngine`).
- `function` declarations for named top-level functions; arrows only for inline
  callbacks and single-expression helpers.
- The React Compiler silently skips any component or hook it can't compile. In them,
  avoid computed-key destructuring and `??=`, end a ref parameter's name in `Ref`, and
  pull a ref out of its object before passing it to `ref`.
- New tests are opt-in: don't write tests unless asked. Tests freeze behaviour Jett
  has signed off, so they come after sign-off, not alongside new work.

## ui feel

- Performance is the #1 UX value. Interactions render synchronously from local
  state; the network is never on the critical path of a click. Thread switching
  must be instant — cached state first, catch-up patches after.
- Keep `:has()` (and Tailwind's `has-*` / `group-has-*`) off high-level containers.
  Chrome restyles an anchor's whole subtree on inserts below it, so one rule on the
  app shell restyles the entire app on every DOM change. Anchor it on the smallest
  element that needs it.
- Components come from a strict ladder: an existing component in this repo, or the
  sketchpad's version if it hasn't been ported yet; else a shadcn/ui or AI Elements
  component if one fits; else compose one from
  shadcn primitives; truly custom only when all fail, and say so in the commit.
- Search dropdowns share one shell, `OptionPicker`'s `search-picker`: a flat
  `rounded-sm p-0` popover, a borderless `CommandInput` row, a `Separator`, then the
  results. Results that aren't Command items (a file tree) still sit under that input
  row — never a bordered `Input` in a padded popover.
- Features the design has but the app can't do yet stay visible but disabled
  (e.g. "Link issue") — never hidden. They're reminders of
  what's still wanted, not clutter.
- Icons are Lucide for git and issue concepts (branches, PRs, commits, diffs) and
  Hugeicons stroke-rounded for everything else, carets included. Deliberate
  Lucide exceptions outside git: `Settings2` (the thread list's filter button and the PR list's Group button).
  Deliberate Hugeicons exception inside git: the worktree folder (`FolderGit2`),
  whose folder matches the project folder it sits beside. Lucide is imported only in `lucide_icons.tsx`, Hugeicons
  only in `huge_icons.tsx`, which wraps each glyph; oxlint bans both packs
  everywhere else, and Phosphor and Octicons outright. Registry components arrive
  speaking lucide — swap their non-git icons to Hugeicons when adding them.

### icons

- Every icon line is 1.333px at every size (CSS non-scaling stroke). Hugeicons
  draw 1.125× their slot through an inset viewBox, centred, without changing
  layout; Lucide draws at slot size.
- Fill (`filled`) only solid metaphors: stop, fast-mode flash, video play/pause,
  the pinned pin. Checks passed/failed reuse the status discs; selected answers
  stay stroked. GitHub is the official filled svgl mark. Provider logos, the
  in-progress glyph, status discs and context ring stay custom.
- Glyphs go bare inside Buttons — the parent cascade sizes them (16px baseline).
  `size-glyph` (18px) is for tab status glyphs only. No arbitrary `size-[Npx]`.
- One muted: `text-muted-foreground`. No `/50`, `/60`, or `opacity-*` tints on
  icons.
- Icon buttons are `Button variant='ghost' size='icon*'` — they idle muted
  automatically (compound variant) and hover with bg fill + text→foreground.
  Text buttons that shouldn't fill use `variant='ghost-text'`: text shift only,
  never a bg. Don't fight ghost with `hover:bg-transparent!`.
- Frosted media controls over photos and video keep bright glyphs; they don't idle muted.
- Controls side by side share one size step: an icon button beside a text button
  takes the matching icon size (`xs` ↔ `icon-xs`, `sm` ↔ `icon-sm`), never a
  smaller size stretched with height classes. Radius follows size, so mixed
  sizes give mismatched corners.
- The tab close button and the thread row's Archive/More buttons
  (`thread_row_actions.tsx`) are deliberately their own thing (tiny, no bg
  hover, sized glyphs) — leave them.
- Status colors are semantic: amber = awaiting approval, destructive = error,
  green = open PR, purple = merged PR. There's no fixed brand colour; the
  user's accent (`primary`) plays that role.
- Link colour in text: accent means a click takes you to one specific thing (a
  thread, issue, commit, file or URL). Counts that open a menu ("3 threads"),
  names, answers and actions are foreground, and the words joining them are
  muted. Things with a colour of their own use it instead of the accent: PR
  links take their state colour, bots their face colour.

- Act on pointer-down, not click, wherever it's safe (Carmack's "act on press"):
  fixed-position controls like sidebar items, tabs, buttons, toggles. It reads as
  instantly responsive and dodges the pressed-but-slid-off miss.
- It's NOT safe for: anything inside a scrollable/draggable surface (down might be a
  scroll), drag-and-drop handles, text selection, long-press targets, double-click
  targets, and destructive or hard-to-reverse actions.
- Also NOT safe for controls that open a modal/overlay (dialogs, the command
  palette): opening on pointer-down lets the same gesture's release land outside
  the new surface and trigger its outside-dismiss (JET-3). Those activate on click.
- Keyboard activation stays standard (Enter/Space per platform norms) — pointer-down
  is a pointer optimization, never an accessibility regression.
- The companion rule: prefer easy undo over confirm dialogs. Act fast, make it
  reversible — don't use a modal as a safety net for an action that could just be
  undoable.
- Paper Mono is for machine text and compact numeric readouts: paths, commands, code,
  branches, SHAs, ids, PR and issue numbers, times like `2m`, token counts, `2/5`. Words
  are Geist Sans, including Jetty tool targets ("Archived 3 threads").
- Overflowing single-line text: fade when it scrolls on hover (`OverflowTitle`
  inside `data-overflow-hover`), ellipsis (`truncate`) when it stays still.

## thread environments

- New threads default to Worktree unless the project sets its own default (below);
  Current checkout works in the project checkout itself. Environment and worktree
  base are fixed at first send. The Current checkout branch is read-only.
- Worktrees live under JETTY_HOME/worktrees/<project-id>/<thread-id>; folders stay
  stable when generated titles rename branches. Branch prefix defaults to jetty.
- `.worktreeinclude` copies matching gitignored source files (without one,
  gitignored `.env*` files outside node_modules) before optional
  `.jetty/worktree.json` setup (`{ "setup": "pnpm install" }`). Setup gets stable
  JETTY_WORKTREE_NAME and a live-worktree JETTY_WORKTREE_SLOT.
- An optional `"archive"` script in the same file runs in the worktree, with the
  same variables, before archive or delete removes it, for cleanup outside the
  folder. A failing script refuses archive; delete logs it and carries on.
- An optional `"environment": "worktree" | "local"` in the same file is the
  project's default environment for new threads (`local` is Current checkout).
- The file's presence marks the project set up, including `{}` when it needs no
  setup command. The new-thread page's Set up worktrees button shows only while
  the file is missing.
- The file is read from the project checkout, never the worktree, which the agent
  can edit.
- Commit work before creating children that build on it. Archive requires a clean
  worktree and removes its folder while keeping its branch; resume recreates it
  and reruns setup. Delete removes the branch only for a linked merged PR.
- `docs/worktree-setup.md` explains all this to an agent setting up a project's
  worktrees (the new-thread page's Set up worktrees button points it there). Keep
  it in step with this section.

## Cloud Agent specific instructions

- Runtime is **Bun** (installed at `~/.bun/bin`, on `PATH` via `~/.bashrc`). The
  startup update script runs `bun install`; all commands below assume `bun` is on
  `PATH`. Standard scripts live in root `package.json` — read it rather than
  memorizing flags.
- **Run without any Claude/API auth**: set `JETTY_AGENT=echo`. The built-in echo
  agent needs zero external deps and is what `bun test` uses. The real `claude`
  agent needs the Claude Code CLI's own auth (`~/.claude`); the code does not read
  `ANTHROPIC_API_KEY` directly, so real-agent turns fail here unless that auth is
  present. Default to `echo` for local testing.
- Dev mode is two processes: `bun run dev:server` (API + WS on `8787`) and
  `bun run dev:client` (Vite on `5173`, which proxies `/ws` + `/attachments` to
  `8787`). Prefix the server with `JETTY_AGENT=echo` for an auth-free stack.
- Vite binds to **`localhost` (IPv6 `::1`) only**, not `0.0.0.0` — health-check it
  via `http://localhost:5173`, not `http://127.0.0.1:5173` (the latter returns no
  connection).
- SQLite is embedded (`bun:sqlite`, file under `~/.jetty`) — there is no database
  service to start.
- `bun test` forces the echo agent; the one live-Claude test is skipped unless
  `JETTY_LIVE_TEST=1` (spends tokens — leave it skipped).
- Drive browsers through `perf/driver.ts` (`openPage`). A Chrome you launch yourself
  needs `--use-mock-keychain --password-store=basic`, or macOS stops Jett with a
  keychain password prompt.

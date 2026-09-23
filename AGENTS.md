# working in this repo

## jetty-v2 branch strategy

- Active development is on `jetty-v2`. Fetch it and base new work on
  `origin/jetty-v2`, not `main`, unless Jett explicitly asks otherwise.
- Commit directly to `jetty-v2` — small, frequent commits, no PRs. Parallel agents
  work in their own worktrees/branches, then rebase onto `jetty-v2` and land as a
  fast-forward once typecheck, lint, format, and tests pass.
- The new backend and frontend ship together in a final `jetty-v2` → `main` PR.
  Don't open or merge that one without Jett's explicit approval.

## project guidance

- taste decisions — tech choices, UX, naming, API shapes — get checked with Jett
  first, every time. When in doubt, ask.
- UI rides default shadcn styles until a dedicated design pass at the end. Don't
  hand-tweak styles before then.

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
- New tests are opt-in: don't write tests unless asked. Tests freeze behaviour Jett
  has signed off, so they come after sign-off, not alongside new work.

## ui feel

- Performance is the #1 UX value. Interactions render synchronously from local
  state; the network is never on the critical path of a click. Thread switching
  must be instant — cached state first, catch-up patches after.
- Components come from a strict ladder: use a shadcn/ui or AI Elements component
  if one fits; else compose one from shadcn primitives; truly custom only when
  both fail, and say so in the PR.
- Features the design has but the app can't do yet stay visible but disabled
  (e.g. "Link issue", the branch picker) — never hidden. They're reminders of
  what's still wanted, not clutter.
- Icons are Phosphor (`@phosphor-icons/react`) or Octicons (`@primer/octicons-react`),
  never lucide. Both packs are intentional — keep each icon in the pack the design
  uses; never convert between them. Registry components
  arrive speaking lucide — swapping their icon imports to Phosphor equivalents is
  part of adding them (lucide's `Chevron*` is Phosphor's `Caret*`). oxlint bans
  `lucide-react` imports so a missed swap fails the lint gate. Weight/stroke
  tuning waits for the design pass — plain swaps until then.

### icons

- Weight is `bold` via the global IconContext; `weight='fill'` only for solid
  metaphors (home, stop).
- Glyphs go bare inside Buttons — the parent cascade sizes them (16px baseline).
  `size-glyph` (18px) is for tab status glyphs only. No arbitrary `size-[Npx]`.
- One muted: `text-muted-foreground`. No `/50`, `/60`, or `opacity-*` tints on
  icons — sole exception: the idle Moon at `/60`, which is semantic (dimmer =
  asleep).
- Icon buttons are `Button variant='ghost' size='icon*'` — they idle muted
  automatically (compound variant) and hover with bg fill + text→foreground.
  Text buttons that shouldn't fill use `variant='ghost-text'`: text shift only,
  never a bg. Don't fight ghost with `hover:bg-transparent!`.
- The tab close button is deliberately its own thing (tiny, no bg hover) — leave
  it.
- Status colors are semantic: amber = awaiting approval, destructive = error,
  green = open PR, purple = merged PR, `code-*` = ember brand.

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

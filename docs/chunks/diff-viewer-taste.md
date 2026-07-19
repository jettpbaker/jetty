# diff viewer — taste decisions

Every deliberate call made while building the diff viewer chunk. All defaulted to
the plainest option; each is here so Jett can iterate. Nothing below is load-bearing
for correctness — they're presentation/UX knobs.

## wire / server

- **Diff source is `git diff HEAD`, shelled out — not the Agent SDK.** The SDK's
  `get_workspace_diff` is an internal control-request subtype with no public method
  on the `Query` handle, and jetty's SDK session only exists during an active turn
  while the diff must be pullable on demand while idle. So we shell `git`.
- **`git diff HEAD` only.** Shows tracked, uncommitted changes vs HEAD. Does **not**
  show untracked/new files (would need `git add -N` first, which mutates the index)
  and does not diff branch-vs-merge-base. Deferred — easy to extend later.
- **Failure = empty diff, never an error.** Non-git dir, no commits yet, git missing,
  spawn throw → `{ diff: '' }`. The panel shows "No uncommitted changes."
- **Truncation removes the whole file section from `diff` and lists the path in
  `truncatedPaths`** rather than keeping a headers-only stub in the patch. Keeps the
  patch fed to `<PatchDiff>` clean; the client renders truncated files as a separate
  compact list.
- **Truncation triggers:** lockfiles by name (`bun.lock`, `bun.lockb`,
  `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, any `*.lock`), or
  any single-file section over **128 KB**. Threshold is a guess — tune freely.

## diff panel (thread route)

- **Closed by default; toggled by a floating ghost `GitDiff` icon** pinned top-right
  of the timeline column. Open state is local component state, not persisted per
  thread or globally.
- **Right sidebar, fixed `480px` wide, left border, `bg-background`.** No resize
  handle, no min/max. Full-screen mode swaps it to a `fixed inset-0` overlay.
- **Expand affordance:** a single arrows-out / arrows-in toggle in the panel header
  (no separate "restore"). Full-screen is transient state, not persisted.
- **Refresh is manual only** — a header button; also fetches once on open and on
  thread switch. **Auto-refresh on turn completion is deferred** (listed, not built):
  it would mean subscribing to thread status here and refetching on the
  running→idle edge. Straightforward to add if wanted.
- **Header is minimal:** title "Diff" + refresh + full-screen + close. No file count,
  no +/- line stats, no branch name.
- **Panel uses the diff library's own Shiki-theme background** (the vendored
  "Dark 2026" theme, `#121314`), not the app's `--card`/`--background` token. Reads
  fine on the dark app but is a hair different from surrounding chrome. Could pin
  `--diffs-dark-bg` to an app token if exact match matters.
- **`diffStyle: 'unified'`** (not split) and **`stickyHeader: true`** so file headers
  pin while scrolling a long diff.
- **Empty / loading / error are plain one-line muted messages**, no spinners or
  skeletons (refresh button spins while in flight).

## edit-row inline diff (tool-row.tsx)

- **Edit rows are expandable; the body is the old→new diff** via the same library
  (`MultiFileDiff` on the two strings). Follows the existing click-to-toggle
  convention exactly. Read rows still never expand; Bash still shows text output.
- **Compact options:** file header hidden (the row already shows the path) and line
  numbers off, for density. `unified` style. Body capped at `max-h-80` with scroll.
- **No diff shown when `old_string === new_string`** or when the strings are missing
  — the row just isn't expandable, same as an empty body.
- **Highlighting is per-row and lazy** (library renders plain text first, then
  upgrades). No worker pool is wired, so highlighting runs on the main thread; fine
  at edit-row scale. Revisit if large edits stutter.

## library / tier

- **`@pierre/diffs` React tier: `PatchDiff` (panel) + `MultiFileDiff` (edit rows).**
  Not `CodeView` — jetty's diffs are small enough that the virtualization-first tier
  buys nothing, and wiring its worker pool + Vite worker entry was not worth it. No
  virtualization hand-rolled. `PatchDiff` parses the unified patch itself, so no
  custom patch parser.
- **Theme fed by name via `registerCustomTheme('dark-2026', …)`** — the library wants
  a theme *name*, not a raw Shiki object, so we register the vendored theme once and
  reference it. Same JSON `response.tsx` uses for markdown fences.
- **App is dark-only**, so both `theme.dark` and `theme.light` point at `dark-2026`
  and `themeType: 'dark'` is hard-set.

## styleguide

- **New "Diffs" tab** with three fixtures: an interactive Edit row (click to expand),
  a statically-expanded Edit diff body, and the panel's `DiffView` rendering a canned
  multi-file patch with a truncated `bun.lock` entry. The Edit row is shown twice
  because `ToolRow` owns its open state internally (no `defaultOpen` prop) — didn't
  want to add one just for the styleguide.

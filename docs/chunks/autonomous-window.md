# autonomous window plan (~30 min, Jett driving)

Delete this note once the window's work is reviewed and landed.

## Constraints

- Fable usage is at ~73% (day started ~45%) — Fable orchestrates only: specs,
  reviews, gates, commits. No hand-building, terse updates.
- Opus and grok usage are separate and safe — route ALL building to them.
  Usage doesn't care which; pick per task fit.
- If usage-limit warnings appear in-session, stop spawning and surface it.

## Work queue (in order)

1. **Land the command palette** (opus build in flight): review the diff,
   run typecheck + lint + full `bun test` unsandboxed, fix findings, commit.
2. **Diff viewer — chunk 9** (opus): `thread.diff` wire method, server-side
   `git diff` in the project cwd (SDK `getWorkspaceDiff` where available),
   render with `@pierre/diffs`, per-edit inline diffs on Edit tool rows
   (old_string/new_string already in input — no wire change), styleguide
   fixtures. Deliberately plain styling + a written list of taste decisions
   for Jett to iterate on after.
   - Placement (Jett's call): diffs live in a **right sidebar panel**, with an
     option to **expand the panel to full screen**.
   - Reading digested (https://pierre.computer/writing/on-rendering-diffs):
     the library has two tiers — File/FileDiff (simple per-file) vs CodeView
     (virtualization-first; owns scroll anchoring, DOM pooling, Shiki worker
     pool). All the perf heroics live inside the library; never hand-roll
     virtualization. For jetty's scale FileDiff-per-file is likely right;
     CodeView acceptable if it makes worker-based highlighting free. Honor two
     patterns regardless: plain-text-first/highlight-after (Shiki must not
     block the panel), and server-side truncation of pathological files
     (lockfiles) in the git diff output. Feed our vendored Dark 2026 Shiki
     theme so diffs match the fences.
3. **Mechanical follow-ups** (grok): reasoning blocks get `usePacedText`
   (port the assistant-message pattern); per-kind `contain-intrinsic-size`
   estimates on timeline items (~2.5rem work rows, ~10rem messages);
   `docs/chunks.md` status refresh (approval dock, palette, stream work).
4. **`fs.search` groundwork** (grok, only if time remains): fuzzy filename
   search over `git ls-files` for future `@file` mentions — server + wire +
   tests only, NO composer UI (taste-gated on Jett).
5. **Home page redesign** (opus, only after everything above): Jett granted
   explicit free rein — "redesign our home page how you feel fit." The one
   sanctioned taste-intensive item. Work within the established language:
   chrome grays, ember-as-attention (never as chrome), Geist, frosted
   surfaces, the ransom wordmark. Separate commit; easy to revert wholesale
   if Jett hates it.

## Rules

- Separate commit per work item so review/revert is piecemeal.
- Don't touch: response.tsx / streamdown-overrides.css (another agent owns
  streaming visuals), anything taste-intensive beyond the listed scope.
- Approval-dock design note stays until Jett confirms the dock in real use.

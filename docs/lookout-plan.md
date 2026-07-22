# Lookout issues — plan of action

Open Lookout issues, first batch against `043711d`.
(Done: JET-6 titler, JET-7 scrollbars, JET-8 question dock, JET-9 token count,
and from the second batch via grok subagents: JET-13 ligatures, JET-15
type-to-focus, JET-18 per-thread composer selection.
Filed: JET-12, question-dock UI polish, for the design pass; JET-22,
rate-limit usage display, research done and probe-verified in the issue.
Still open from batch two, needing Jett: JET-14 favicon, JET-16 skills from
composer, JET-17 subagent-views spike, JET-19 thread descriptor, JET-20
reviewed-workflow spike.)
Grouped by what they need, with a proposed working order at the bottom.
Nothing gets built until you've signed off on this doc.

**Candidate new filing** (found during JET-7): you can't scroll up while a
long thread is streaming — items using `content-visibility: auto` keep
remeasuring, so the scroller's autoscroll re-pins you to the bottom. Also
means jetty currently uses classic (not overlay) scrollbars whose track runs
behind the floating composer — accepted for now, revisit at the design pass
(opencode-style overlay thumb is the candidate upgrade).

## Group B — bugs needing investigation first

### JET-5 · Syntax highlighting intermittently partial — DIAGNOSED, fix pending review

**Not a race, and not streamdown.** The diff panel renders via `@pierre/diffs`
(markdown fences are a separate streamdown/Shiki pipeline). Root cause,
**reproduced deterministically** in a dummy Vue 2.7 repo driven through the
real UI:

- jetty's `thread.diff` sends a unified git patch; `@pierre/diffs` parses it as
  `isPartial` (no full file contents) and tokenizes **each hunk in isolation**.
- For a `.vue` file the grammar is `vue`, and JS only gets keyword/string
  scopes _inside_ a `<script>` embedding. A hunk whose ±3 context lines don't
  include the `<script>` tag never enters the JS grammar → every line renders
  flat editor-foreground. Hunks that happen to include `<script>` (or template
  markup, whose attribute strings the vue grammar colours directly) highlight
  fine.
- "Random" = where git's context window happens to fall relative to the SFC's
  section tags. Verified both directions live: a mid-`<script>` hunk in
  `Dashboard.vue` → completely flat; hunks touching `<script>`/template in
  `UserCard.vue` → fully coloured. Same session, same warm grammar.

**Fix options, ranked** (none applied — awaiting review):

1. **Preferred:** have `thread.diff` also ship full old/new file contents and
   render non-partial (`MultiFileDiff`-style), so the highlighter sees the
   whole SFC. Server reads both sides from git; kills the bug for every
   language, not just vue.
2. Cheap mitigation: larger `-U` context on the server's git diff — more hunks
   catch a `<script>` tag, but mid-file edits in long scripts still break.
3. Per-hunk language override (script-looking vue hunk → `javascript`) —
   heuristic, fragile.

Repro assets: dummy repo at `scratchpad/vue-dummy` (project already added in
jetty), grok's full pipeline report in the session tasks dir. Note: the exact
"strings coloured on the same line as flat keywords" look in the Lookout
screenshot likely mixes a flat script hunk with neighbouring template lines —
worth one confirming glance at a real work diff after the fix.

## Group C — needs your input before/while building

### JET-4 · Optimistic send (message + thread view instantly)

Core to jetty's #1 UX value (network never on the click path). On send:
immediately swap to thread view, render the message pending from local state,
reconcile on server ack. Touches composer → store → thread view flow, so it's
a real chunk with a design note first per the repo workflow. No taste
questions expected, but flagging it as the largest code change in Group C.

### JET-10 · Diff viewer polish

Four parts, three of them unambiguous:

- open from the **existing sidebar icon** (not the separate diffs icon)
- overlapping the tab bar is fine
- open/close **instant**, no animation
- **resizable** — ⚠️ you wanted to weigh in on the approach. Options:
  a) free drag handle with a remembered width
  b) snap widths (e.g. ⅓ / ½ / ⅔) via drag or a cycle button
  c) drag handle with soft snap points (free drag + magnetic common widths)
  My lean: (a) free drag + remembered width — least mechanism, feels native.

### JET-11 · [Spike] Thread archive/deletion behaviour

Pure decision spike — deliverable is a decision + follow-up issues, not code.
Taste calls for you:

- archive only, delete only, or both?
- if delete: trash-then-purge or immediate? (additive-only migrations mean
  soft-delete flag either way; hard delete needs a considered path)
- where do actions live (thread row menu / thread view) and where do archived
  threads go (hidden, filter toggle, separate view)?
  My lean: archive-only for now (soft flag, hidden from list, restorable),
  defer true delete until there's a real need.

## Proposed order

1. **JET-5** — investigate + fix the highlighting race.
2. **JET-4** — optimistic send (design note → build → walkthrough).
3. **JET-10** — diff viewer polish, once you've picked the resize approach.
4. **JET-11** — settle over a chat whenever suits; it's conversation, not code.

## Questions for you

1. JET-10: which resize approach — free drag (my lean), snap widths, or hybrid?
2. JET-11: archive-only to start (my lean), or do you want delete too?
3. Happy with the order above, and how many of these do you want done this
   session?

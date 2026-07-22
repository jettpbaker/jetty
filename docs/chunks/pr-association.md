# Threads ↔ PRs — direction sketch

Status: **exploration, nothing settled.** Came out of mining Capy's docs
(`inspo/capy.md`, their thread/task/PR association) on 2026-07-21. No issue
filed yet; taste questions deliberately deferred to build time.

## The idea

A jetty thread can produce (or adopt) GitHub PRs, and those PRs become
first-class in-app surfaces — rendered natively in the right panel, not links
out to GitHub. Unlike Capy, jetty has no structural one-branch-per-task
constraint: a long-lived thread making several PRs is normal, so the
association is **many-to-many from day one** — a thread can have N PRs, and a
PR can belong to multiple threads (e.g. a new thread opened to fix review
findings on an existing PR).

## Association mechanics (proposed, unbuilt)

`thread_prs(thread_id, repo, pr_number)` join table, no uniqueness on either
side. Additive migration. Three ways rows get created, in order of expected
value:

1. **Observe the exhaust.** The agent creates PRs via `gh pr create` through
   the Bash tool; the server sees every tool result. Watch outputs for
   `github.com/{owner}/{repo}/pull/{n}` URLs and auto-associate with the
   producing thread. Zero harness changes, works retroactively on stored
   transcripts. (Same pattern as Capy's Vercel-preview detection: integrate
   by observing, not by wiring.)
2. **Branch inference.** If thread commits adopt a branch naming convention
   (`jetty/<thread-slug>-…`), PRs whose head branch matches can be swept up
   even when no URL appeared in a tool result. Convention itself is
   undecided.
3. **Manual attach/detach.** Pin any PR to a thread; remove wrong
   auto-associations. Keeps the automation honest without needing it perfect.

Open at build time: whether an auto-association announces itself in the
timeline (a "Opened PR #12" row) or the tab just appears. Lean timeline row,
undecided.

## PR view feasibility (researched, looks clear)

Everything Capy renders is available from GitHub's API: PR metadata +
mergeability, per-file patches (`pulls/{n}/files`), Checks API for status
rollups, issue-timeline for the timeline, review threads and comments, and
all the writes (create, comment, merge). GraphQL can batch a page into one
round trip. Diff rendering reuses `@pierre/diffs` — same partial-patch caveat
as JET-5, same fix (fetch both file versions, render full-context).

Auth story (proposed): inherit the `gh` CLI's existing login — jetty is
local and single-user, so no GitHub App / encrypted multi-tenant token
machinery needed. Token stays server-side (same rule as the Linear token);
client asks our server, server talks to GitHub. Escalation rungs if ever
needed: fine-grained PAT → GitHub App (only if jetty goes multi-user).

Freshness: no webhooks for a local app, so polling — on-focus refresh + slow
interval. Fits "cached state first, catch-up after". Rate limits are a
non-issue at our scale.

Known fiddly bit: mapping review-comment anchors to diff positions (GitHub's
position/line model). Well-trodden, not a blocker.

## UI direction (leans, not decisions)

**Right panel → tabbed artifact area.** The diff panel generalizes to tabs of
thread-associated artifacts: diff today; each PR is its own tab; possibly the
clicked-into subagent transcript later (or that stays the thread-swap from
`subagents-workflows.md` — unresolved). One PR = one tab, so N PRs need no
special handling in the panel. Interacts with JET-10's resize work.

**Thread tab bar: one glyph slot, rollup + count.** A tab never stacks N
icons. Proposed rule: PR glyph, small numeral when N > 1, color/state carries
a worst-state-wins rollup (needs-attention ≻ open/pending ≻ merged/closed —
mirrors GitHub's combined-status semantics). Single PR is the degenerate
case: no numeral, icon shows state directly. Sketch-level details, all
revisitable: fully-settled sets maybe decay to a plain icon; narrow tabs drop
the count before the icon; hover behavior undecided.

## What this is not

- Not scoped, not sequenced against existing chunks, no issue yet.
- The PR view itself is a large surface (checks, review threads, timeline
  each want real treatment) — if built, likely its own chunk after the
  association plumbing.
- All naming (`thread_prs`, branch convention, tab copy) is placeholder.

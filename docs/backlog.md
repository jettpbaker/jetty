# backlog

Deferred on purpose. Delete items as they land; delete this file when it's empty.

## sketchpad designs not ported yet (needs Jett's call)

- Design rebuilt Settings (sidebar nav, merged Models page) after our port.
  Ignoring until Jett says otherwise.
- PR view E (sketchpad `pr_redesign/jetty_style.tsx`). Agreed for the port:
  mark generated files on the server (`git check-attr linguist-generated`, then
  known lock/minified/source-map/protobuf names, then a `@generated` /
  `Code generated … DO NOT EDIT` header) so Hide generated works; read GitHub's
  real `viewerDefaultMergeMethod` for the merge button's "last used"; and give
  the Changes tab the same diff skin (Jetty's status green/red). The checks
  list's design pass (jettpbaker/jetty-issues#11) is done there: grouped
  Failing / Running / Successful, skipped folded into one row.
- Picks waiting until the ported UI is polished (sketchpad on :5174):
  - Command palette, two looks: `/components/command-palette`, or in the app
    preview `/components/app?palette=a|b`.
  - Settings redesign, two looks (A Document, B Window): `/components/settings`,
    or `/components/app?settings=a|b`.
  - Issues view (`/components/issues`, `/components/issue-page`) and PR view E's
    review flows (comment from the gutter, start a review, suggest, submit with a
    verdict). In its comment box, selecting text opens the formatting toolbar
    below the selection, not above it.
  - PR description edits are last-writer-wins across devices; an "edited
    elsewhere" guard is possible.
- Thread hover panel redesign, `/components/thread-hover`: linked PRs one per
  row, three variations against today's (B, the row's own header with PRs and
  child threads as rows and a quiet footer, was recommended). Needs a
  back-and-forth session with Jett before porting. The panel doesn't get child
  threads or per-PR checks and review state yet.
- Custom merged and closed PR glyphs drawn on Lucide's open PR icon:
  `/components/pr-state-icons` (family D: merged with filled rings eased a quarter
  unit, closed with the ✕ on the top ring and equal gaps). Tried in the app
  (86b8a34) and reverted for now; come back to it.
- An icon for the PR overview's Thread row: `/components/icon-picks` (thread
  section). B (Message multiple 01) was recommended.

## chat view review (one pass, with Jett)

Everything below is for one combined review of the chat, not separate ports.

- Streaming and the chat view in general: Jett wants it better overall; this is
  the umbrella the rest hangs off.
- Automated messages, `/components/auto-messages`: one family for everything
  Jetty or another thread sends into a chat (restart resume and limit, child
  reports, relays, compaction, PR watch wakes, a background command exiting).
  C's seams are directionally right; compaction's "Compacting" and "Compacted"
  are ported (`ChatSeam`). Today child reports and the restart continuation
  render as user-looking relayed bubbles. Agents should get a real Jetty sender
  (e.g. `<jetty-notice kind="…">`) instead of the restart note's borrowed
  `from: { self, 'Jetty' }`.
- Queued messages, `/components/queued-messages`: queued messages as dashed
  bubbles in the transcript instead of the strip above the composer (B, a dashed
  seam with the count or "Paused · Resume", was recommended, with in-place
  editing; ⌘↵ to steer is an option). Needs: show relays and child reports the
  client filters out today, a stored pause reason, a resume, a short hold so
  Cancel can Undo, an edit hold longer than 60s, and a "steered" marker worked
  out from turn order.
- Child thread card, `/components/child-card`: one card per turn for the
  threads a parent starts, and how a report arrives later (C, bare rows, was
  recommended). Not picked yet.
- Message footers: the whole footer reveals on hover; `revealWholeFooter` in
  `message_footer.tsx` flips it to time and model always visible.

## later

- Chat review in the app: a dev-only route that replays recorded and fixture threads
  through the app's real chat components, replacing the sketchpad's copy of the chat
  (`/chat-review`), which drifts and needs re-syncing.
- PR view: say why a PR is red or yellow. The tab and sidebar glyphs colour by readiness
  (a merge conflict, failing checks, changes requested), but the Status row only says
  "Open". Show the readiness reason there, e.g. "Open · Merge conflict" in red.
- Orca-style source-control actions: rebase from base, create PR, merge PR in-app.
  Merge through GitHub's async merge API (GA 2026-10-01): a PUT to
  `/repos/{o}/{r}/pulls/{n}/merge-async` returns an id to poll (`pending` →
  `merged` | `enqueued` | `failed`; results kept 24h). One endpoint covers direct
  merge, merge queue and stacks. Pin `sha` to the head the user saw (a push
  mid-merge cancels it), keep `bypass_rules` false, and show the in-between
  states in the PR view: Merging…, In merge queue, Failed with the reason.
- Stacked PRs from parent/child threads: a child's worktree builds on its
  parent's, so their PRs could open as a GitHub stack, and one async merge of
  the top PR lands every downstack layer together or none of them. Needs a
  stack model in the GitHub client.
- Accept `#<PR number>` as a worktree ref by fetching the PR head.
- Continue work on an existing branch.
- Later, if restarts keep killing waits: a Jetty-owned `wake_me` tool (a time
  plus an optional precheck command Jetty runs host-side; Orca's automations
  --precheck pattern) that survives restarts and works for every provider.
- Redesign the agent question card's answer options (composer_strip.tsx). Of
  four sketchpad looks, Jett liked Tint best (no leading mark; the pick is
  tinted with a trailing tick), so the sketchpad's composer strip uses it for
  now. Still needs a proper redesign with Jett in the loop before it's ported.
- Per-worktree dev server ports (after worktrees v1, which ignores ports): Jetty
  gives each live worktree a slot number (JETTY_WORKTREE_SLOT, lowest free) and
  a project's setup script derives a port block from it (base + slot * 20, one
  offset per service). Figure out the work repo first: how many services an
  admin run needs, which ports are hardcoded (vite config, service-to-service
  URLs), and what's pinned outside the repo (OAuth redirects, CORS, flag
  setups registered for localhost). If those can't move, focused-thread
  forwarding (the thread you're viewing owns the default ports) is the
  fallback. Also: shared backend vs per-worktree, and the Linux inotify limit.
- Spotlight (Conductor's name), the alternative to per-worktree ports: toggle it
  on a worktree thread and Jetty mirrors that worktree's tracked files into the
  project checkout (snapshot commit, check it out), watching for the agent's
  edits, so the dev server already running there hot-reloads on the thread's
  code. One thread at a time, one-way; switching swaps, off restores the
  checkout. Open: the user's own uncommitted work in the checkout (stash or
  refuse), and Local threads writing there at the same time. Start with a POC.
- Slash / skill commands in the composer (`/verify`, `/pr`, …). The server
  already lists skills (`skills.list` in server/src/skills.ts reads project and
  user skills, including `user-invocable`), but no client uses it yet.
  How others do it (~/code/ctx, Sept 2026):
  - t3code (wraps provider CLIs, like us) puts three kinds in one `/` menu:
    built-ins applied locally (model, plan…), provider slash commands passed
    through as text (offered only at the start of the prompt, the only place
    providers expand them), and skills inserted as a `$name` chip usable
    anywhere (composerSlashCommandSearch.ts).
  - t3code discovers skills per provider, not from one scan: Codex app-server
    `skills/list`, `grok inspect --json` (includes plugin skills, honours
    disabled ones), and a filesystem scan for Claude (`~/.claude/skills` +
    `<cwd>/.claude/skills`, user wins on name clashes; the SDK init only gives
    names). `.agents/skills` is Codex-only.
  - Dispatch differs per provider (ClaudeSkillDispatch.ts): Codex parses `$name`
    natively. Claude only expands `/name args` when it opens the last text block,
    and only one per message, so t3code rewrites the last `$name` into a
    `/name <rest>` block and earlier ones to inline `/name` (the model runs
    those via its Skill tool). A `$word` that isn't a known skill stays literal
    (`$HOME`).
  - opencode (its own agent) keeps one command registry of custom commands, MCP
    prompts and skills (badged in the menu); `/name args` at the start calls a
    `session.command` endpoint that expands the template server-side, adding
    "Base directory for this skill: <dir>" so relative paths resolve.
    For us: follow t3code. Ask Codex and Grok for their own catalogs instead of
    scanning files, keep our scan for Claude, and do the `/name` rewrite for
    Claude.

- Long threads, after the streaming fix: opening one still sends its whole
  state, and the background save rewrites the whole JSON (~30ms every 2s at
  10MB while streaming). Next step: page snapshots by turns (t3code: last 10
  turns, then 20 per page) and slim tool output on the wire.
- Grok threads read idle while background subagents run: Grok emits no
  `subagent` items (its `spawn_subagent` call shows as a tool row that settles
  at once with "Subagent started in background"), so the reducer's "running
  subagent keeps the thread working" rule has nothing to see. Fix: translate
  `subagent_spawned`/`subagent_finished` (those without `workflow_run_id`) into
  subagent items keyed by `subagent_id`. Open question: their tabs would have
  no transcript.
- Grok runs commands in its own sandbox: `gh` can't reach the keychain token (401 on
  PR creation) and writes outside the project are blocked even after approval.
- Queued-message remove has no undo (needs a server-side hold).
- Workflows, after the v1 cut (status lines under the composer, sidebar working,
  a2a in-chat row, per-workflow stop): the detail view (c1 / c1b / c1c in the
  sketchpad) and resume. Resume plan: after a restart jetty resumes interrupted
  Claude workflows once, automatically; Resume shows only if that fails, you
  stopped it, or it's Grok (same-process resume only). States: Running, Finished,
  Failed, Stopped — no "Interrupted".
- Grok doesn't report context usage, so its ring stays empty.
- Bump `@anthropic-ai/claude-agent-sdk` now and then (Claude runs on the
  installed CLI; the SDK is just the protocol client).
- Code block syntax colours: chat and description code blocks (sketchpad
  `src/components/custom/code_block.tsx`, not ported) hardcode
  `pierre-light-soft` / `pierre-dark-soft`. Jett picked Cursor's theme for the PR
  view's diffs (the sketchpad's `pr_redesign/cursor_themes.ts`, with Jetty's
  diff colours over it); use it for code blocks too so code looks the same
  everywhere.
- Binary files in the PR diff read `-0 +0` beside "Diff not shown". The header
  lives in the diff library's shadow DOM, so it needs a CSS poke or a library
  option.
- Linked-PR change detection misses changes that don't bump `updatedAt`
  (mergeability flips, thread resolution). If that bites, a 10-minute full
  refresh floor for linked PRs is a two-line addition (an open PR view already
  refreshes fully every 30s).
- Perf lab: exact frame counts need Chrome's 120 Hz begin-frame control, which
  is Linux-only (headless Chrome in Docker). A separate spike.
- Design pass on toasts (sonner), with Jett; not a priority. A first study is
  in the sketchpad at `/components/toasts` (Today, Card, Pill).
- Issues over GitHub Projects, with Jett. A first study is in the sketchpad at
  `/components/issues-projects`: a per-Project mapping gives fields roles
  (status category, priority level, type, sidebar section, row details), with
  List, Sidebar, Board and Setup looks over two fake Projects.

## Jetty Bots / project orchestrators (working name, design discussion)

Jett wants a high-level bot per project, meant to orchestrate ordinary threads
rather than implement code itself. He already uses a Fable thread to create and
direct Opus threads at work. Make that workflow intentional instead of relying on
a long-lived ordinary thread and its conversation history. The distinction is
between an agent instructed to delegate and a product that reliably owns delegated
work; Jetty already has the former. No bot architecture, UI, naming, API, storage,
or provider choices have been approved. Jett owns product/taste decisions.

This consolidates the October 1, 2026 discovery in project Drive
`plans/jetty-bots.md`, `research/jetty-bots/capy-capabilities.md`, and
`research/jetty-bots/jetty-primitives.md`. The initial Jetty survey used
[`a2cf606`](https://github.com/jettpbaker/jetty/tree/a2cf606d9a67382e21e4da83cf068ebec746fbe6).
The code boundaries below were re-read on October 5 at
[`94fb754`](https://github.com/jettpbaker/jetty/tree/94fb7540955d0b068296749a1e89a986b95e2689);
that is source verification, not a runtime exercise of delegation or callbacks.
Capy public claims and documentation conflicts are from the October 1 research,
not a fresh audit of today's product. Keep these evidence categories separate:

- **Demonstrated:** actually exercised in the Captain conversation.
- **Available, unexercised:** exposed in that environment, without proving it
  works in every project or that it is Captain-specific.
- **Documented:** described by the linked official public source, not runtime
  verification or evidence of Capy's internal implementation.
- **Proposed:** a Jetty possibility that still needs discussion with Jett.

### The observed Captain loop

Captain created JETT-12, a separate read-only crew thread with its own agent and
workspace. Its bounded brief named ownership, deliverables and verification
limits, and prohibited repository changes and PRs. The worker saved
`reports/JETT-12.md` in the shared Captain Drive and reported completion. That
completion resumed Captain, which read both the report and the transcript before
updating `DIGEST.md` from work in progress to a completed report. `NOTES.md`
preserved scope and owner. These were deliberate agent-authored files, not an
automatic transcript export or proven automatic digest/notes maintenance.

Jett could inspect the ordinary worker thread directly while Captain remained the
coordinating conversation. The demo used no timer, PR, CI, review or runtime test.
The subsequent research threads observed their own identity, Captain-directed
reporting and shared files; they did not exercise the broader lifecycle map below.
A digest presents state, but the source conversation, evidence and responsible
worker are still needed before a coordinator can accept a result.

### Capy reference: coordination and execution

The [April 16 update](https://capy.ai/blog/april-2026-update) says Build mode was
deprecated and Captain plans, delegates, monitors and ships from one conversation.
[Tasks](https://docs.capy.ai/tasks) also describes a controlling thread coordinating
long-lived sibling threads. Neither establishes a permanent project Captain
singleton that owns all threads.

- [Threads](https://docs.capy.ai/threads) are durable conversations holding
  machines, tasks and PR history. Independent root threads have their own
  workspaces and are separately addressable; a standalone crew thread is not a
  nested task. Search, rename, archive, folders, pins, tags and interrupt/queue/
  steer controls are documented. Broader crew creation, membership changes and
  cross-agent communication were available; adoption of arbitrary existing
  threads and its ownership semantics were not established by the demo.
- [Tasks](https://docs.capy.ai/tasks) are full child agents with separate
  conversations and tools, editable drafts, explicit starts and nesting up to
  three levels. They start from their brief, not the parent's entire conversation.
  Ordinary parallel work belongs in tasks; sibling threads remain independent
  root workspaces. The coordinator explicitly inspects their state rather than
  inheriting or continuously streaming every conversation. The
  [API overview](https://docs.capy.ai/api-reference/overview) exposes thread
  creation, inspection, transcripts/messages, rename/archive and organization,
  but direct API task access is read-only; tasks are driven through messages to
  their owning thread.
- [Tasks](https://docs.capy.ai/tasks) documents independent model choices with
  parent inheritance by default, shared machines for readers, fresh upstream
  checkouts for writers, and parallel versus stacked work. Shared reading and
  isolated writing are different placement choices, not implied by delegation.
  [Models & pricing](https://docs.capy.ai/models-and-pricing) covers provider/
  subscription routes, reasoning controls, fast modes and thread/task choices.
  Model selection and later model changes were available but unexercised.
  [Machines](https://docs.capy.ai/machines) documents independent execution
  environments and explicit artifact transfers; no isolation or transfer
  experiment was performed in this research.

### Capy reference: durable working state and verification

[Drive](https://docs.capy.ai/volumes) documents intentionally saved non-Git files,
organization/personal/project/project-personal/automation scopes, scoped
instructions and skills, editing/upload, saved history and restore. Automation
scope can carry state between runs. The October 1 documented limits were
100 MiB per file, 2 GiB per saved version and 10 GiB per organization; history does
not retain every intermediate version. Retained-version inspection was available
but unexercised. The Captain-specific sharing used by the demo was evident in the
environment but absent from the public scope table. Reading `NOTES.md` and
`DIGEST.md` proves readable persistent files, not automatic generation,
synchronization or semantic memory retrieval.

[Tasks](https://docs.capy.ai/tasks) documents automatic final-summary delivery
waking the parent and blocked questions surfacing to it; interim progress is read
on demand and does not wake the parent. Finished work remains on its machine until
the parent inspects and ships it. A completion is a handoff, not automatic
acceptance. The coordinator must inspect the actual diff, transcript, source and
appropriate tests/screenshots, respecting stated verification limits. Passing
checks or a confident worker report alone do not establish the user's goal.

Durable conversation identity is separate from disposable execution.
[Machines](https://docs.capy.ai/machines) says filesystem state survives sleep but
processes, memory and connections do not. Tracked background operations keep the
machine awake; detached servers do not. A backing can be replaced, and 30 idle
days deletes machine state. Git/PRs preserve code; Drive preserves intentionally
saved non-code artifacts. A long-lived bot or notebook does not guarantee live
workers or servers. [Threads](https://docs.capy.ai/threads) documents archive as
dormancy with incoming events retained as pending context and a human message
reviving the thread; manual resting status marks are overwritten when conversation
resumes. Those semantics were not tested. Sleeping, at rest, archived, cancelled
and successfully completed must not be treated as synonyms.

### Capy reference: callbacks, waits and standing work

[Pull requests](https://docs.capy.ai/pull-requests) documents CI failure wake/fix/
re-push, consolidated passing checks, enabled automatic-review verdicts,
human-feedback wakeups and merge follow-through. Metadata, checks, comments and
review findings can be inspected. This map was available but unexercised: the
research produced no PR, CI, review or merge. Follow-through ownership matters
separately from digest presentation: the most recent pushing thread takes PR
ownership, and [Troubleshooting](https://docs.capy.ai/troubleshooting) warns that
out-of-band PR creation does not get the normal automatic subscription. Event
delivery or ownership takeover was not verified in this pass.

One-off timers, waits for running operations and event watches for PR/GitHub/
Slack/webhook events were available but unexercised. They continue one finite piece
of work; they are not evidence of a continuously running agent.
[Troubleshooting](https://docs.capy.ai/troubleshooting) recognizes timer, task, CI
and callback waits, but the research found no dedicated public guide to the
general-purpose one-off watch capability. Do not conflate this source gap with
unsupported behavior or confuse one-off waits with recurring automations.

[Automations](https://docs.capy.ai/automations) documents stored prompts triggered
by cron, GitHub, Slack, incoming webhooks or on demand, creating fresh threads or
feeding a standing thread. These are standing policies with identity, spending
and disable controls, not prerequisites for a first bot. The documented run-as
principal is fixed, eligibility is checked per run, unavailable pinned models fail
visibly rather than being silently replaced, principal offboarding disables the
automation, and a daily run cap is optional. Cron has a five-minute floor and
missed occurrences coalesce. [Authentication](https://docs.capy.ai/api-reference/authentication)
documents organization-owned service users, project access, role restrictions and
optional spend caps. No waits, watches, automations, identity or billing changes
were exercised by the research.

### Capy reference: human authority, security and recovery

[Threads](https://docs.capy.ai/threads) documents interrupt, queue and steer plus
needs-attention/review/active/waiting/idle buckets. Structured clarification,
secure variable requests, human desktop assistance, deliberate task stop/resume
and failed-work inspection were available but unexercised.
[Security](https://docs.capy.ai/admin/security) explicitly prohibits merges or
auto-merge without a specific user request; tool availability does not mean every
command has a human approval gate.

[Secrets](https://docs.capy.ai/secrets) documents securely supplied thread variables,
but commands can read them and output is not masked. A shared machine can expose
personal workload variables to whoever drives it. Access needs to be scoped and
revocable; secure collection is not isolation from execution.
[Troubleshooting](https://docs.capy.ai/troubleshooting) covers retry/resend after
balance errors, degraded setup recovery, machine rebuilds and human messages
waking stalled work. These controls do not establish automatic restart after
every failure or guaranteed eventual completion. No credentials or approvals were
requested during the research.

### Capy source gaps and documentation conflicts

The October 1 search covered the [documentation index](https://docs.capy.ai/llms.txt),
official product/docs pages and Captain posts. It did not establish a project-wide
Captain singleton, native crew digest algorithm, automatic notes maintenance,
crew-wide completion-dashboard semantics, arbitrary existing-thread adoption,
automatic restart after every failure or guaranteed eventual completion. Absence
in that bounded search is not evidence of absence in the product; do not invent
Capy's backend to fill the gaps or copy every task/automation feature into Jetty.

1. [Capy 101](https://docs.capy.ai/using-capy) still described Captain versus Build
   and said Captain does not run commands or edit files, while the later
   [April update](https://capy.ai/blog/april-2026-update) deprecated Build. Prefer
   the later threads/tasks model over treating old restrictions as universal.
2. [automations.md](https://docs.capy.ai/automations.md) returned an older
   schedule-only guide with Build/Captain selection, unlike the canonical
   [Automations page](https://docs.capy.ai/automations) with event triggers,
   standing threads and run-as principals. The research used the canonical page.
3. [Reviews](https://docs.capy.ai/review) described permission cards, older
   Captain/Build terminology, fixed posting thresholds and `.capy/REVIEW.md`.
   [Instructions](https://docs.capy.ai/instructions) says per-agent instruction
   files are deprecated; the [review-settings reference](https://docs.capy.ai/api-reference/reviews/configure-review-settings)
   exposes per-repository off/once/always policy and configurable thresholds.
   General review/triage is documented, but check older UI/permission advice
   before translating it into a design.

### Jetty's existing foundations and their boundaries

The October 1 tour found Bun/Effect, React/Vite, embedded SQLite, typed WebSocket
RPC, durable sequenced events and optimistic client updates. At the October 5
source check, `shared/src/wire.ts` and `shared/src/rpc.ts` use Effect schemas;
README's description of shared zod contracts is stale (the MCP inputs still use
zod). README's “orchestrator” is the server turn-lifecycle service, not a project
bot. README also documents Claude background monitoring as memory-only liveness
that clears on session closure or server restart.

- **Documentation and design locations:** `docs/backlog.md` holds intentionally
  deferred work; the existing orchestrator instructions and callback note are
  consolidated here, not competing bot entries. October 1 found only the backlog
  under `docs/`; October 5 also has `docs/pull-request-data-layer.md`, describing
  PR queries, caching and writes, not a bot spec. No general feature-spec
  directory convention was established. `.agents/skills/improve-animations/SKILL.md`
  and its `PLAN-TEMPLATE.md` prescribe `plans/NNN-short-slug.md` and
  `plans/README.md` specifically for motion audits, with `animation-plans/` as
  fallback, not a general product convention. `AGENTS.md` makes this repo the UI
  source of truth and documents `~/code/scratch/jetty-design` as a mock-data
  sketchpad; the research did not inspect it. `CLAUDE.md` points to `AGENTS.md`.
  The project Drive planning files are Capy artifacts, not a new Jetty surface.
- **Project state and app surfaces:** the inspected `Project` in
  `shared/src/wire.ts` has id, filesystem path, title, createdAt and optional icon.
  `server/src/db.ts` persists projects, threads, events/projections, provider
  sessions, orchestration state, attachments and PR links, but no dedicated
  project notes/documents/bot table. Project actions in `shared/src/rpc.ts` cover
  creation/deletion, icon and branches, not notes/library authoring.
  `client/src/routes/{__root,index,threads.$threadId,settings,pull-requests.index,pull-requests.$owner.$repo.$number}.tsx`
  has no dedicated notes/bots route. `client/src/components/custom/thread_details_tabs.tsx`
  offers Chat, Overview, Changes, Threads, linked PRs and an opened file;
  `thread_details_layout.tsx` shows child threads. This is a bounded source
  finding, not a claim about unseen designs, branches or runtime state.
- **Files and media:** `fs.browse`, `fs.search` and `thread.readFile` in
  `shared/src/wire.ts` are filesystem/project/thread-oriented. File reads can
  return missing, binary or too-large status; `client/src/components/custom/thread_file.tsx`
  is a read-only viewer, and `thread_details_layout.tsx` routes file links into
  Changes or a file tab. Browser uploads accept PNG/JPEG/GIF/WebP; attachment
  references are keyed by thread and attachment in `server/src/db.ts`. Agent
  image/video tools in `server/src/mcp.ts` can reuse media resolved within the
  caller's project. None of this is an editable project-document library.
- **Ordinary delegation:** `ThreadMeta` in `shared/src/wire.ts` carries project,
  environment, provider/model/effort, parent, user/agent creator, pending messages
  and review state. `server/src/db.ts` persists lineage, notification flag,
  permissions, queue, turn hop/creation counts and idempotent request results.
  `server/src/mcp.ts` exposes `list_threads`, `read_thread`, `list_models`,
  `create_thread`, `send_message`, `mark_ready_for_review`, PR linking and
  `archive_thread`, plus media tools. These operate on ordinary threads; no
  dedicated coordinator role/type is represented in the inspected contracts.
- **Scope and inspection limits:** listing/reading/messaging require active,
  unarchived threads in the same project. `read_thread` returns at most 20 user/
  assistant messages, each truncated to 4,000 characters. Its `after` cursor
  reads newer messages, not the full tool/event trace. A coordinating agent
  cannot equate this bounded text view with complete verification evidence.
- **Creation and placement:** `create_thread` accepts prompt, optional title,
  provider/model/effort, local/worktree environment, ref, notify flag and request
  ID. It immediately creates/enqueues an ordinary child, not a draft task or
  persistent bot. Maximum lineage depth is 2, with at most 5 creations per turn.
  Environment defaults to the caller's; Local shares the project checkout and
  ignores ref. Worktree defaults to the caller's current HEAD for worktree
  callers, otherwise origin's default branch. Commit parent work before creating
  children that build on it. Live provider discovery (`list_models`) determines
  availability; reading source proves no model catalog on Jett's host.
- **Messaging and reporting:** `send_message` queues behind an active turn unless
  `steer=true`, with `requestId` for safe retries. It refuses a target with a
  higher access mode than the sender; `server/src/store.ts` bounds messages to
  20 hops. `agentText` in `server/src/orchestrator.ts` instructs a child to report
  via `send_message`, including useful attachment IDs. This is explicit worker
  reporting, not automatic success-completion delivery. Automatic failure
  notifications in `store.ts` require notification enabled, an unarchived parent,
  the parent as turn initiator, hop budget and an outcome not already recorded.
  `notify=false` also suppresses the creator-report instruction. An agent-created
  child calling `mark_ready_for_review` gets `reportsTo` rather than flagging the
  user; the parent reports to the user.
- **Control limits:** agents can archive another project thread, not themselves;
  worktrees must be clean, and archive removes the folder while keeping the
  branch. There is no general stop/interrupt-other-thread MCP tool in
  `server/src/mcp.ts`. Separate UI/client RPCs in `shared/src/rpc.ts` expose
  `turn.interrupt`, `workflow.stop`, `background.stop`, queue controls,
  archive/unarchive, rename, pin and delete. Do not treat client controls as
  agent-exposed capabilities or assume Capy's archive semantics apply to Jetty.

### Reliable callbacks and agent-facing instructions

Keep Jett's prior callback request, recorded in
[`aafa2c5`](https://github.com/jettpbaker/jetty/commit/aafa2c5b9bd3528f579e19c897be7034bf25bd83):
consider app-delivered completion/failure callbacks that notify and resume the
coordinating thread, rather than relying solely on a worker's explicit report.
Consider reliability across app restarts and duplicate delivery/retries. The note
selected no callback architecture and implemented no runtime behavior.

For design discussion, distinguish a turn ending from the assigned work being
complete, and callback delivery from accepting the worker's result. Define which
coordinator owns each event, including adopted threads and PR follow-through,
what happens while it is paused/archived or its workspace disappears, how pending
delivery survives restarts, and how retries avoid duplicate reports or actions.
Existing persisted queues and request IDs are useful primitives, not proof of
end-to-end success callbacks or guaranteed recovery. Outcomes, blockers and
evidence need inspection; status/digest updates should not silently upgrade an
unverified handoff to done. These are reliability considerations, not a chosen
schema, delivery guarantee or implementation plan.

Design Jetty's built-in instructions (`server/src/jetty-instructions.ts`) around
the desired workflow: work out of a couple of orchestrator threads, children
report up, the parent reports to the user (`mark_ready_for_review`), and archive
finished threads. Optional behavior belongs in Settings → Agent behaviour.
Jett reviews every place Jetty talks to agents, not just that file:

1. The base instructions and Agent behaviour sentences
   (`server/src/jetty-instructions.ts`, `agentBehaviours` in `shared/src/wire.ts`).
2. MCP tool descriptions (`server/src/mcp.ts`).
3. The relayed-message wrapper and child's report-back line
   (`agentText` in `server/src/orchestrator.ts`).
4. System messages and tool results agents read (`Thread X failed: …`,
   `send_images`/`send_video` results and MCP error texts).

The sketchpad's bot avatar at `/components/bot` is not ported; retain Jett's
request to call his own bot Sauron when bots land. That personal name does not
settle the feature name or its navigation/identity design.

### Candidate first version and unresolved decisions

This is a candidate scope for discussion, not an approved design:

1. A project-scoped orchestrator identity/conversation explicitly meant to
   coordinate rather than modify code.
2. Existing ordinary threads as workers, with visible ownership and model choices;
   no new nested task system just to match today's Fable-to-Opus workflow.
3. Reliable outcomes and blocker delivery, with source evidence inspected before
   a worker's claim becomes the bot's status.
4. A durable plan and user-facing current queue useful after context condensation
   or process restart; readable files versus structured app data is unresolved.
5. Clear user override, pause and control boundaries. Recurring automation is a
   separate optional extension, not a prerequisite.

The ownership question remains open: does the bot manage only work it creates,
also explicitly adopted existing threads, or every thread in the project? This
affects scope and whether users can keep independent work independent. Do not
assume project-wide ownership or a singleton. Then resolve these design axes with
Jett, without treating them as blockers to recording the research:

- What distinguishes a bot from a normal thread: identity/navigation, lifecycle,
  capabilities, or a combination? Is it an enhanced ordinary thread or a separate
  entity, and where does it live?
- Does it own child threads, the project queue, decisions, durable plans, or some
  combination? How are adoption, reassignment and PR follow-through represented?
- Which events resume it, and how are retried messages/callbacks kept from
  duplicating actions? What needs a finite wait/watch versus a standing policy?
- What is authoritative structured application state and what belongs in readable
  documents? How are durable notes and the queue presented? The demo's Markdown
  convention need not be Jetty's storage design.
- How does the user inspect, correct, pause or dismiss the bot and its workers?
  Which actions require approval, and what happens on worker failure or workspace
  loss?
- Can the existing creation/control primitives support a small first version,
  and which missing primitives are genuinely necessary? Keep independent coding
  threads, child tasks and the coordinating bot conceptually distinct rather
  than assuming Capy's crew branding maps exactly to this proposal.

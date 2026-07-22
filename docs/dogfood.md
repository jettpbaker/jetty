# dogfood loop

jetty is daily-driven at work and fixed at home, with Linear as the queue.
This doc is the contract for the agents on both ends. No scripts — agents
compose the API calls themselves.

## identities

Both agents act in Linear as their own OAuth app users, not as Jett:

- **Claude Cook** — home side. **Claude Lookout** — work side.
- Tokens are minted with the `client_credentials` grant (30-day expiry):
  POST `https://api.linear.app/oauth/token` with
  `grant_type=client_credentials&client_id=…&client_secret=…&scope=read,write,app:assignable,app:mentionable`.
  (`app:assignable` is what lets the app user be set as issue assignee —
  without it `issueUpdate` fails with "App user not valid".)
  Credentials live in `~/.config/jetty/linear-app.env` (`COOK_*` / `LOOKOUT_*`),
  the minted token next to it (`linear-cook-token` / `linear-lookout-token`).
- Send the token as `Authorization: Bearer <token>` on the GraphQL API — and it
  works on `mcp.linear.app` too, for MCP-capable clients.
- On a 401, re-mint from the stored credentials and retry. No ceremony.

## roles

- **work Claude** (MCP disabled): files issues via the Linear GraphQL API
  with curl. Never modifies this repo — its checkout is read-only and its
  job is capture, not fixing.
- **home Claude** (Linear MCP): triages, fixes on `main`, verifies live,
  reports back on the issue.
- **Jett**: hits the friction, says a sentence, pulls when idle. Taste
  calls stay theirs.

## filing an issue (work side)

API: `POST https://api.linear.app/graphql`, header `Authorization: $LINEAR_API_KEY`
(raw key, no Bearer). Team: **Jetty**, id `7dc37e1c-a8f4-4653-b5f6-28a84122d820`.

What a filing must carry — format is the agent's call, content is not:

- **Version**: `git rev-parse --short HEAD` of the running checkout, in the
  description. Non-negotiable — it's what makes home repro possible.
- **What happened + repro** in Jett's words, captured while fresh. Ask one
  clarifying question if the repro is vague, not five.
- **Evidence when it helps**: screenshot/GIF via the `fileUpload` mutation →
  PUT to the signed URL (send its headers verbatim, 60s expiry) →
  `attachmentCreate` with the assetUrl.
- **Priority = interrupt semantics**: Urgent (1) means "this is blocking
  Jett right now, fix immediately". Everything else defaults to Medium and
  gets batched. Don't inflate.
- Check for an existing similar issue before filing a duplicate.

The `delight` label is the opposite of a bug: something felt great and
should be protected from future changes. File those too.

## fixing (home side)

- Assign yourself, move to In Progress when actually started.
- Fix lands on `main` — no stable branch; the only test bench is real use.
- Sqlite migrations are additive-only (new tables/columns; never rename or
  drop) so any older checkout can still read a newer db.
- Verify live (drive the UI, attach evidence when the fix is visual), then
  Done with a comment: commit hash + what to expect after pulling.

## work machine setup (from a fresh clone)

For the agent standing jetty up on the work machine. Note: AGENTS.md /
CLAUDE.md in this repo govern home-side _development_ — your contract as a
work-side agent is this document only.

1. Clone read-only (deploy key or read-scoped token — the write credential
   deliberately does not exist on this machine) and `bun install`.
2. `bun run build` then `bun run start` — jetty is one process at
   `http://localhost:8787` (override with PORT). No dev servers needed.
3. Data lives in `~/.jetty/jetty.db`, never in the repo. Back it up before
   every pull: `cp ~/.jetty/jetty.db ~/.jetty/backups/jetty-$(git -C <repo> rev-parse --short HEAD).db`
4. Linear: `LOOKOUT_CLIENT_ID`/`LOOKOUT_CLIENT_SECRET` in
   `~/.config/jetty/linear-app.env`; mint your token per the identities
   section, then file a test issue as Claude Lookout to prove the pipe.

## updating work jetty

- `git pull --ff-only` when idle — never mid-turn; threads persist in
  sqlite so an idle restart loses nothing.
- Back up the db first: `cp <db> backups/<db>-$(git rev-parse --short HEAD)`.
- If a pull breaks something: file it Urgent, `git checkout last-good`,
  keep working. The `last-good` tag is moved retroactively (home side)
  to whatever state survived a real stretch of driving.

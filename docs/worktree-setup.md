# Setting up Jetty worktrees

The user wants this project ready for Jetty's worktree threads. Jetty, the app you're
running in, can give each thread its own git worktree, and a project can tell Jetty how
to make a fresh worktree ready to work in. Your job is to write that config so a new
worktree thread can get going straight away (dependencies installed, the right local
files in place, dev servers on their own ports), check that it works, and commit it.

This guide explains how Jetty's worktrees behave, then what a good setup looks like.

## How Jetty worktrees work

### Worktree threads

A thread runs in one of two environments, chosen before its first message:

- **Worktree** (the default): the thread gets its own `git worktree`, a separate folder on
  its own branch (`jetty/<title>` by default). Several agents can work on the same repo at
  once without touching each other or the user's checkout.
- **Current checkout**: the thread works directly in the project folder.

The environment and the worktree's base commit are fixed at the first send.

### Where worktrees live

`$JETTY_HOME/worktrees/<project-id>/<thread-id>`, where `JETTY_HOME` is `~/.jetty` unless
set. The folder name stays the same when the branch is later renamed after the thread's
title. A worktree checks out the whole repository; if the project is a subfolder of a
repo, the thread works in that subfolder of the worktree.

### What a new worktree goes through

1. `git worktree add` at the base commit. The folder has every tracked file and nothing
   else: no `node_modules`, no build output, no gitignored files.
2. Gitignored files are copied in from the project checkout (see `.worktreeinclude`).
3. The `setup` script runs, from the worktree's root, if there is one.
4. Then the thread's messages go to the agent.

If setup fails, the thread shows the error (the tail of its output) with a Retry button,
and messages wait. Retry runs steps 2 and 3 again in the same folder, so setup needs to be
safe to run twice.

### Archive, resume and delete

Archiving a thread removes its worktree folder and keeps its branch. It needs a clean
worktree: no uncommitted changes or untracked files (gitignored files are fine).
Resuming an archived thread recreates the folder and runs setup again. Deleting a thread
removes the folder whatever its state.

### `.worktreeinclude`

A file at the repository root, in `.gitignore` syntax, saying which gitignored files to
copy from the project checkout into each new worktree. A file is copied only if it's
gitignored and matches; tracked files are already there. Files are copied one at a time
and symlinks are skipped, so don't list big trees like `node_modules` or build caches:
install or build those in setup instead.

Without a `.worktreeinclude`, Jetty copies gitignored files whose names start with `.env`
(`.env`, `.env.local`, `apps/web/.env.development`, ...) outside `node_modules`. A
`.worktreeinclude` replaces that default entirely, so list the `.env` files in it too if
the project still needs them.

To preview what a `.worktreeinclude` will copy, from the repository root of the checkout:

```sh
comm -12 <(git ls-files -oi --exclude-standard | sort) \
         <(git ls-files -oi --exclude-from=.worktreeinclude | sort)
```

### `.jetty/worktree.json`

Also at the repository root. Every field is optional:

```json
{
  "setup": "bun install --frozen-lockfile",
  "archive": "docker compose -p \"app-$JETTY_WORKTREE_NAME\" down -v",
  "environment": "worktree"
}
```

- **`setup`**: a shell command run in each new worktree, from its root, after the files
  are copied. It times out after 15 minutes.
- **`archive`**: a shell command run in the worktree before Jetty archives or deletes it,
  for cleaning up anything that lives outside the folder. If it fails, archive is refused
  and the user sees the error, rather than silently leaking whatever it was meant to clean
  up. Delete logs the failure and carries on. The worktree must still be clean after it
  runs.
- **`environment`**: `"worktree"` or `"local"`, the default environment for this project's
  new threads (`"local"` is Current checkout). Leave it out unless the user wants a
  different default or worktrees can't work for this project.

Both scripts run with `sh -lc`, in Jetty's own environment plus:

- **`JETTY_WORKTREE_NAME`**: the worktree folder's name. It stays the same for the
  worktree's whole life, across archive and resume, so it's good for naming per-worktree
  resources like databases or compose projects.
- **`JETTY_WORKTREE_SLOT`**: a small number, the lowest one no other live worktree is using
  (across all projects), starting at 0. It's freed when a worktree is archived or deleted,
  and a resumed worktree may get a different one. Good for picking ports.

### Read from the checkout, never the worktree

Jetty reads `.jetty/worktree.json` and `.worktreeinclude` from the project checkout (the
user's main working copy), never from a worktree, because an agent in a worktree can edit
its own copy. Changes take effect for the next worktree Jetty creates, once they're in the
checkout. An invalid file (bad JSON, a script that isn't a string, an unknown
environment) makes every worktree's setup fail with `Invalid .jetty/worktree.json`, so
check it parses.

## Look at the project first

Things worth finding out before writing anything:

- **Package manager and lockfile.** Which one (bun, pnpm, npm, yarn, uv, poetry, cargo,
  go, bundler, ...) and its frozen, cache-friendly install:
  `bun install --frozen-lockfile`, `pnpm install --frozen-lockfile --prefer-offline`,
  `npm ci`, `uv sync --frozen`. A monorepo or nested projects may need more than one.
- **Local files.** Which gitignored files the project needs that a fresh clone lacks.
  `git ls-files -oi --exclude-standard` in the checkout lists the candidates; most are
  build output, a few are env files, local config or certificates.
- **Dev servers and ports.** How the project runs (package.json scripts, Procfile,
  docker-compose, Makefile, README) and where its ports come from: env vars, config
  files, or hardcoded.
- **Codegen.** Anything generated and gitignored that the code or typecheck needs:
  Prisma or Drizzle clients, GraphQL or OpenAPI types, protobuf, route trees, built
  workspace packages.
- **Databases.** Local databases, migrations and seeds, and whether a worktree can share
  the checkout's database or needs its own.
- **The project's own notes.** README, AGENTS.md, CLAUDE.md, CONTRIBUTING,
  `.devcontainer` and CI config often spell out exactly how to bootstrap.

## Write the setup

### Fast and idempotent

Every worktree thread waits for setup before its agent starts, and Retry runs it again
over a half-finished attempt.

- Use the frozen, cache-friendly install; most package managers are quick with a warm
  cache.
- Do what a fresh worktree needs to work and no more: install, codegen, per-worktree
  config. Building everything or running tests can wait for the agent that needs them.
- Don't start long-running processes like dev servers. Setup has to finish.
- If it's more than a line or two, put it in a script in the repo (say
  `scripts/worktree-setup.sh`, with `set -eu`) and point `setup` at it. It's easier to
  read, test and change.
- Everything setup writes should be gitignored. An untracked file makes the worktree
  dirty, and a dirty worktree can't be archived. `git status --porcelain` should print
  nothing after a run.

### Copy the right files

Prefer copying with `.worktreeinclude` over generating files, unless they have to differ
per worktree. If the default (`.env*` files) already covers what the project needs, you
don't need a `.worktreeinclude` at all.

### Per-worktree ports

If the project runs dev servers, two worktrees running them at once will fight over ports,
and so will a worktree and the user's checkout. Give each worktree its own block of ports
from the slot, offset so slot 0 doesn't collide with the checkout's defaults:

```sh
base=$((4100 + JETTY_WORKTREE_SLOT * 10))
web=$base
api=$((base + 1))
```

Setup's variables are gone once it exits, so write the ports where the project's tooling
already reads them, usually a gitignored env file it loads (Vite and Next load
`.env.local` and `.env.development.local`). A file of their own that nothing is copied
into works best: setup can overwrite it on every run, so a rerun gives the same result.

If a port is hardcoded, making it read an env var with the old value as the fallback is a
small, safe change worth making. If it's also registered somewhere outside the repo (OAuth
redirect URLs, CORS allowlists, webhooks), that's for the user to decide.

### Clean up what lives outside the folder

If setup creates anything that outlives the folder (a database, Docker containers or
volumes, files under `~` or `/tmp`), add an `archive` script that removes it, keyed by
`JETTY_WORKTREE_NAME`. Make it tolerate things already being gone (`dropdb --if-exists`,
`docker compose down` on a project that isn't running), since a failing archive script
blocks archiving. If setup only touches the worktree folder, there's nothing to clean up.

## Check it works

Run the setup the way Jetty will, in a scratch worktree. Roughly:

```sh
checkout=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
scratch=$(mktemp -d)/worktree
git worktree add --detach "$scratch" HEAD
# copy from $checkout what .worktreeinclude matches (or the default .env* files),
# as Jetty would, plus any new setup files that aren't committed yet
cd "$scratch"
time JETTY_WORKTREE_NAME=scratch JETTY_WORKTREE_SLOT=9 sh -lc '<your setup command>'
git status --porcelain
```

Then:

- run setup a second time: it should succeed again, and quickly;
- if there are dev servers, start them briefly and check they come up on the slot's
  ports, then stop them;
- run the archive script, if there is one, the same way;
- remove the scratch worktree with `git worktree remove --force "$scratch"`.

If you can't verify something (it needs credentials you don't have, or a service that
isn't running), say so in your report instead of guessing.

## Commit it

Commit `.jetty/worktree.json`, any `.worktreeinclude`, and any setup script, following the
project's commit conventions. Jetty only reads the config from the project checkout, so:

- in the Current checkout, it's live as soon as the files are there;
- in a worktree thread (your working directory is under `$JETTY_HOME/worktrees/`), your
  commit is on the thread's branch and takes effect once it reaches the checkout. Land it
  the way this project lands changes (its AGENTS.md or contributing notes usually say),
  or tell the user it needs merging.

## When to ask

Make most of these calls yourself. Anything safe or easy to undo (which files to copy,
install flags, the port base, adding a script, whether an archive step is needed) you can
just decide, do, and mention in your report.

Ask the user when you're genuinely unsure, or the call is theirs:

- the project needs secrets or services you can't find or reach;
- the choice changes how they work day to day, like a database per worktree instead of a
  shared one, or Docker instead of running things locally;
- it would mean changing something outside the repo, such as OAuth redirect URLs;
- it would cost money or touch shared infrastructure.

## Report back

Finish with a short summary: what setup does and how long it took in your test, which
files get copied, how ports are assigned (if they are), what the archive script cleans
up, anything you couldn't verify, and anything the user still needs to do, like landing
the commit or filling in a secret.

# Running Jetty on a workspace

For an agent setting Jetty up to run all the time on a machine, such as a remote dev workspace,
and be opened from a browser.

## Install

Jetty needs Bun (the version in `package.json` `engines`) and Git, plus:

- `gh`, logged in (`gh auth login`), for pull requests. Jetty acts as that login.
- At least one supported agent CLI, logged in: Claude Code, Codex, GitHub Copilot or Grok. Claude is optional.

```sh
git clone https://github.com/jettpbaker/jetty.git ~/jetty
cd ~/jetty
bun install
bun run build
```

Leave the checkout as a clean clone on `main`. Updates come from the sidebar and need exactly that
(see below).

## Start

```sh
HOST=127.0.0.1 PORT=8787 JETTY_ALLOWED_ORIGINS=<url> bun run start
```

- `HOST` and `PORT` are where the server listens. Keep it on `127.0.0.1`, and reach it through
  an SSH port forward or the workspace's own port proxy.
- `JETTY_ALLOWED_ORIGINS` is a comma-separated list of the origins a browser opens Jetty from,
  when that isn't `localhost`. An example is a proxy URL such as
  `https://8787--dev--me.coder.example.com`. Without it, the browser can't connect.
- `JETTY_HOME` is the data folder. It defaults to `~/.jetty`, and only one Jetty may use it at a
  time.

Run it somewhere that outlives the shell, such as a detached `tmux` session. Logs go to stdout and
stderr.

With Codex only, check `codex login status` on the server host and start Jetty normally. In the
browser, add a project and choose a Codex model in the composer. Settings → Connected accounts
shows which providers are signed in; Settings → Intelligence chooses models for titles and PR
guides. These jobs fall back to an available provider when Claude is absent. A thread keeps the
provider it started on, so continuing an existing Claude thread requires signing in to Claude.

## Staying up

`bun run start` restarts the server:

- after an update
- after a crash, if it had been running for at least 30 seconds

A crash straight after starting exits instead, since restarting it would only crash again. Threads
that were working resume after a restart.

Starting Jetty when the machine boots is up to the workspace: for example, its startup script runs
the command above in a detached `tmux` session.

## Updates

When `origin/main` has newer commits and the checkout is a clean `main`, the sidebar shows
**Update Jetty**. Clicking it:

1. backs up the database to `$JETTY_HOME/backups/`, keeping the newest three `update-*.db` files
2. fast-forwards the checkout
3. runs `bun install`
4. builds the client
5. restarts Jetty

Open windows reload once it's back. If a step fails, the checkout goes back to where it was, Jetty
keeps running, and the row says what went wrong.

Local changes in the checkout, or a branch other than `main`, turn updates off.

## Check it

`curl -s http://127.0.0.1:8787/ >/dev/null && echo up` should print `up`.

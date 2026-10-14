import { Effect } from 'effect'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { AgentError } from './agent'
import { providerCli } from './provider-cli'
import { openStdioConnection, string, type StdioProcessOptions } from './stdio-rpc'

export const COPILOT_ARGS = ['--acp', '--stdio', '--no-auto-update']

export function copilotBin(options: StdioProcessOptions = {}) {
  const command =
    options.command ??
    process.env.JETTY_COPILOT_BIN ??
    providerCli('copilot', 'JETTY_COPILOT_LIVE_TEST')
  const PATH = [
    options.env?.PATH ?? process.env.PATH,
    join(homedir(), '.local/bin'),
    join(homedir(), '.bun/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
    .filter(Boolean)
    .join(delimiter)
  return Bun.which(command, { PATH }) ?? command
}

export function copilotError(message: string) {
  return new AgentError(
    /not.*(?:logged|signed)\s*in|authentication required|login required|unauthenticated/i.test(
      message
    )
      ? 'GitHub Copilot is not signed in. Run copilot login in your terminal.'
      : message
  )
}

export function openCopilotConnection(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const connection = yield* openStdioConnection(cwd, {
      ...options,
      name: 'GitHub Copilot',
      jsonrpc: true,
      command: copilotBin(options),
      args: options.args ?? COPILOT_ARGS,
      env: { ...process.env, ...options.env },
    })
    const init = yield* connection.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'jetty', version: '2.0.0' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    // Existing CLI credentials are used by session/new; authenticate opens a terminal login.
    return { connection, init }
  }).pipe(Effect.mapError((error) => copilotError(error.message)))
}

// session/new saves a session in the Copilot home even when nothing is sent. A probe that only
// reads models, commands or sign-in removes its session once the process has exited, so it never
// lands in the user's Copilot history.
export function probeCopilotSession(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    let sessionId = ''
    yield* Effect.addFinalizer(() =>
      sessionId
        ? Effect.promise(() =>
            rm(
              join(
                options.env?.COPILOT_HOME ??
                  process.env.COPILOT_HOME ??
                  join(homedir(), '.copilot'),
                'session-state',
                sessionId
              ),
              { recursive: true, force: true }
            )
          )
        : Effect.void
    )
    const { connection } = yield* openCopilotConnection(cwd, options)
    const session = yield* connection.request('session/new', { cwd, mcpServers: [] })
    sessionId = string(session.sessionId)
    return { connection, session }
  })
}

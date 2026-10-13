import { Effect } from 'effect'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { AgentError } from './agent'
import { openStdioConnection, type StdioProcessOptions } from './stdio-rpc'

export const COPILOT_ARGS = ['--acp', '--stdio', '--no-auto-update']

export function copilotBin(options: StdioProcessOptions = {}) {
  const command = options.command ?? process.env.JETTY_COPILOT_BIN ?? 'copilot'
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

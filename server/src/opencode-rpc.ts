import { Effect } from 'effect'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { AgentError } from './agent'
import { providerCli } from './provider-cli'
import { openStdioConnection, type StdioProcessOptions } from './stdio-rpc'

export const OPENCODE_ARGS = ['acp']

export function opencodeBin(options: StdioProcessOptions = {}) {
  const command =
    options.command ??
    process.env.JETTY_OPENCODE_BIN ??
    providerCli('opencode', 'JETTY_OPENCODE_LIVE_TEST')
  const PATH = [
    options.env?.PATH ?? process.env.PATH,
    join(homedir(), '.opencode/bin'),
    join(homedir(), '.local/bin'),
    join(homedir(), '.bun/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
    .filter(Boolean)
    .join(delimiter)
  return Bun.which(command, { PATH }) ?? command
}

export function opencodeError(message: string) {
  return new AgentError(
    /authentication required|api key.*(?:expired|invalid|missing)|invalid api key|not.*(?:logged|signed)\s*in|login required|unauthenticated|unauthorized/i.test(
      message
    )
      ? 'OpenCode is not signed in. Run opencode auth login in your terminal.'
      : message
  )
}

// Config is merged over the user's own, and OpenCode has no flag for it. Instructions are file
// paths, not text.
export function opencodeConfigEnv(config: Record<string, unknown>) {
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }
}

export function openOpencodeConnection(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const connection = yield* openStdioConnection(cwd, {
      ...options,
      name: 'OpenCode',
      jsonrpc: true,
      command: opencodeBin(options),
      args: options.args ?? OPENCODE_ARGS,
      env: { ...process.env, ...options.env },
    })
    const init = yield* connection.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'jetty', version: '2.0.0' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    return { connection, init }
  }).pipe(Effect.mapError((error) => opencodeError(error.message)))
}

// Runs an OpenCode subcommand and returns stdout without colour codes.
export function runOpencode(
  args: string[],
  cwd: string,
  options: StdioProcessOptions = {},
  timeout = 20_000
) {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([opencodeBin(options), ...args], {
        cwd,
        env: { ...process.env, ...options.env },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        timeout,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      if (code !== 0) throw new Error(stderr.trim() || `opencode ${args[0]} exited with ${code}`)
      // oxlint-disable-next-line no-control-regex
      return stdout.replace(/\x1b\[[0-9;]*m/g, '')
    },
    catch: (error) => new AgentError(error instanceof Error ? error.message : String(error)),
  })
}

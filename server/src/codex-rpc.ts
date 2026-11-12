import { Effect } from 'effect'

import { providerCli } from './provider-cli'
import { openStdioConnection, type StdioProcessOptions } from './stdio-rpc'

export const DEFAULT_CODEX_ARGS = [
  'app-server',
  '--listen',
  'stdio://',
  '-c',
  'tools.update_plan.enabled=true',
]

export function codexBin(options: StdioProcessOptions = {}) {
  return (
    options.command ?? process.env.JETTY_CODEX_BIN ?? providerCli('codex', 'JETTY_CODEX_LIVE_TEST')
  )
}

export function openCodexConnection(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const connection = yield* openStdioConnection(cwd, {
      ...options,
      name: 'Codex',
      command: codexBin(options),
      args: options.args ?? DEFAULT_CODEX_ARGS,
    })
    yield* connection.request('initialize', {
      clientInfo: { name: 'jetty', title: 'Jetty', version: '2.0.0' },
      capabilities: { experimentalApi: true },
    })
    yield* connection.notify('initialized', {})
    return connection
  })
}

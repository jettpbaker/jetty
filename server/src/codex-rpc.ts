import { Effect } from 'effect'

import { openStdioConnection, type StdioProcessOptions } from './stdio-rpc'
export { object, string, type RpcId, type RpcMessage } from './stdio-rpc'
export type CodexProcessOptions = StdioProcessOptions
export type CodexConnection = Effect.Success<ReturnType<typeof openCodexConnection>>

export function openCodexConnection(cwd: string, options: CodexProcessOptions = {}) {
  return Effect.gen(function* () {
    const connection = yield* openStdioConnection(cwd, {
      ...options,
      name: 'Codex',
      command: options.command ?? process.env.JETTY_CODEX_BIN ?? 'codex',
      args: options.args ?? ['app-server', '--listen', 'stdio://'],
    })
    yield* connection.request('initialize', {
      clientInfo: { name: 'jetty', title: 'Jetty', version: '2.0.0' },
      capabilities: { experimentalApi: true },
    })
    yield* connection.notify('initialized', {})
    return connection
  })
}

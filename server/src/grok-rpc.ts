import { Effect } from 'effect'

import { AgentError } from './agent'
import { object, openStdioConnection, type StdioProcessOptions } from './stdio-rpc'

export function openGrokConnection(cwd: string, args: string[], options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const connection = yield* openStdioConnection(cwd, {
      ...options,
      name: 'Grok',
      jsonrpc: true,
      command: options.command ?? process.env.JETTY_GROK_BIN ?? 'grok',
      args: options.args ?? args,
    })
    const init = yield* connection.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'jetty', version: '2.0.0' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    })
    const methods = Array.isArray(init.authMethods) ? init.authMethods.map((m) => object(m).id) : []
    const methodId =
      process.env.XAI_API_KEY && methods.includes('xai.api_key') ? 'xai.api_key' : 'cached_token'
    if (!methods.includes(methodId))
      return yield* Effect.fail(new AgentError('Run grok login first, or configure XAI_API_KEY'))
    yield* connection.request('authenticate', { methodId, _meta: { headless: true } })
    return { connection, init }
  })
}

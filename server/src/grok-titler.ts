import { Effect, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'
import { tmpdir } from 'node:os'

import { openGrokConnection } from './grok-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'
import { normalizeTitle, TITLE_INSTRUCTIONS, titlePrompt, type Titler } from './titler'

const DEFAULT_TITLE_MODEL = 'grok-4.7'

export function createGrokTitler(options: StdioProcessOptions = {}, model = DEFAULT_TITLE_MODEL) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const titler: Titler = (text) =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = tmpdir()
          const { connection } = yield* openGrokConnection(
            cwd,
            ['--no-plan', 'agent', '--no-leader', 'stdio'],
            options
          )
          const session = yield* connection.request('session/new', { cwd, mcpServers: [] })
          const sessionId = string(session.sessionId)
          yield* connection.request('session/set_model', { sessionId, modelId: model })
          yield* Queue.takeAll(connection.messages)
          const promptId = yield* connection.startRequest('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: `${TITLE_INSTRUCTIONS}\n\n${titlePrompt(text)}` }],
          })
          let reply = ''
          while (true) {
            const message = yield* Queue.take(connection.messages)
            if (message.id !== undefined) {
              yield* connection.reject(message.id, 'Titling does not use tools')
              continue
            }
            const update = object(message.params.update)
            const content = object(update.content)
            if (
              message.method === 'session/update' &&
              message.params.sessionId === sessionId &&
              update.sessionUpdate === 'agent_message_chunk' &&
              content.type === 'text'
            )
              reply += string(content.text)
            if (
              (message.method === '$response' && message.params.requestId === promptId) ||
              (message.method === '_x.ai/session/prompt_complete' &&
                message.params.sessionId === sessionId)
            )
              return normalizeTitle(reply)
          }
        })
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catch(() => Effect.succeed(null))
      )
    return titler
  })
}

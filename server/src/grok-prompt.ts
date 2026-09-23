import { Effect, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'
import { tmpdir } from 'node:os'

import type { ModelPrompt } from './utility-model'

import { openGrokConnection } from './grok-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

export function createGrokPrompt(options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const prompt: ModelPrompt = (model, instructions, text) =>
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
          yield* connection.request('session/set_model', { sessionId, modelId: model.id })
          yield* Queue.takeAll(connection.messages)
          const promptId = yield* connection.startRequest('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: `${instructions}\n\n${text}` }],
          })
          let reply = ''
          while (true) {
            const message = yield* Queue.take(connection.messages)
            if (message.id !== undefined) {
              yield* connection.reject(message.id, 'This request does not use tools')
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
              return reply
          }
        })
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catch(() => Effect.succeed(null))
      )
    return prompt
  })
}

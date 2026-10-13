import { Effect, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { tmpdir } from 'node:os'

import type { ModelPrompt } from './title-model'

import { copilotInput } from './copilot'
import { setCopilotModel } from './copilot-models'
import { copilotError, openCopilotConnection } from './copilot-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

export function createCopilotPrompt(options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const prompt: ModelPrompt = (model, effort, _fast, instructions, text) =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = tmpdir()
          const { connection } = yield* openCopilotConnection(cwd, options)
          const session = yield* connection.request('session/new', { cwd, mcpServers: [] })
          const sessionId = string(session.sessionId)
          yield* setCopilotModel(connection, sessionId, session, model.id, effort)
          yield* Queue.takeAll(connection.messages)
          const requestId = yield* connection.startRequest('session/prompt', {
            sessionId,
            prompt: copilotInput(`${instructions}\n\n${text}`),
          })
          let reply = ''
          while (true) {
            const message = yield* Queue.take(connection.messages)
            if (message.id !== undefined) {
              if (message.method === 'session/request_permission')
                yield* connection.respond(message.id, { outcome: { outcome: 'cancelled' } })
              else yield* connection.reject(message.id, 'This request does not use tools')
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
            if (message.method === '$response' && message.params.requestId === requestId) {
              const error = string(object(message.params.error).message)
              if (error) return yield* Effect.fail(copilotError(error))
              if (object(message.params.result).stopReason !== 'end_turn')
                return yield* Effect.fail(
                  new Error('GitHub Copilot title request did not complete')
                )
              return reply
            }
          }
        })
      ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
    return prompt
  })
}

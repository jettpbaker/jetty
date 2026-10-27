import type { EffortLevel } from '@jetty/shared/events'
import type { ModelRef } from '@jetty/shared/wire'

import { Effect, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { tmpdir } from 'node:os'

import type { ModelPrompt } from './title-model'

import { opencodeInput } from './opencode'
import { setOpencodeModel } from './opencode-models'
import {
  opencodeConfigEnv,
  opencodeError,
  openOpencodeConnection,
  runOpencode,
} from './opencode-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

export function createOpencodePrompt(options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const prompt: ModelPrompt = (model, effort, _fast, instructions, text) =>
      opencodePrompt(model, effort, `${instructions}\n\n${text}`, tmpdir(), options).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
      )
    return prompt
  })
}

function opencodePrompt(
  model: ModelRef,
  effort: EffortLevel | undefined,
  text: string,
  cwd: string,
  options: StdioProcessOptions
) {
  return Effect.scoped(
    Effect.gen(function* () {
      // OpenCode keeps every session in its database and ACP cannot delete one, so a prompt that
      // is not a thread removes its own.
      let sessionId = ''
      yield* Effect.addFinalizer(() =>
        sessionId
          ? runOpencode(['session', 'delete', sessionId], cwd, options).pipe(Effect.ignore)
          : Effect.void
      )
      const { connection } = yield* openOpencodeConnection(cwd, {
        ...options,
        env: { ...options.env, ...opencodeConfigEnv({ permission: { '*': 'ask' } }) },
      })
      const session = yield* connection.request('session/new', { cwd, mcpServers: [] })
      sessionId = string(session.sessionId)
      yield* setOpencodeModel(connection, sessionId, session, model.id, effort)
      yield* Queue.takeAll(connection.messages)
      const requestId = yield* connection.startRequest('session/prompt', {
        sessionId,
        prompt: opencodeInput(text),
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
          if (error) return yield* Effect.fail(opencodeError(error))
          if (object(message.params.result).stopReason !== 'end_turn')
            return yield* Effect.fail(new Error('OpenCode prompt did not complete'))
          return reply
        }
      }
    })
  )
}

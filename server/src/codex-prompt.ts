import { Effect, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'
import { tmpdir } from 'node:os'

import type { ModelPrompt } from './utility-model'

import { openCodexConnection } from './codex-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

export function createCodexPrompt(options: StdioProcessOptions = {}) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const prompt: ModelPrompt = (model, effort, instructions, text) =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = tmpdir()
          const connection = yield* openCodexConnection(cwd, options)
          const { account } = yield* connection.request('account/read', {})
          if (!account) return null
          const started = yield* connection.request('thread/start', {
            cwd,
            model: model.id,
            ephemeral: true,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            baseInstructions: instructions,
          })
          const threadId = string(object(started.thread).id)
          yield* connection.request('turn/start', {
            threadId,
            input: [{ type: 'text', text, text_elements: [] }],
            ...(effort ? { effort } : {}),
          })
          let reply = ''
          while (true) {
            const message = yield* Queue.take(connection.messages)
            if (message.id !== undefined) {
              yield* connection.reject(message.id, 'This request does not use tools')
              continue
            }
            if (message.params.threadId !== threadId) continue
            const item = object(message.params.item)
            if (message.method === 'item/completed' && item.type === 'agentMessage')
              reply = string(item.text)
            if (message.method === 'turn/completed') return reply
          }
        })
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catch(() => Effect.succeed(null))
      )
    return prompt
  })
}

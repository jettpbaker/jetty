import { Effect, Queue } from 'effect'
import { ChildProcessSpawner } from 'effect/unstable/process'
import { tmpdir } from 'node:os'

import { object, openCodexConnection, string, type CodexProcessOptions } from './codex-rpc'
import { normalizeTitle, TITLE_INSTRUCTIONS, titlePrompt, type Titler } from './titler'

const DEFAULT_TITLE_MODEL = 'gpt-6-luna'

export function createCodexTitler(options: CodexProcessOptions = {}, model = DEFAULT_TITLE_MODEL) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const titler: Titler = (text) =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = tmpdir()
          const connection = yield* openCodexConnection(cwd, options)
          const { account } = yield* connection.request('account/read', {})
          if (!account) return null
          const started = yield* connection.request('thread/start', {
            cwd,
            model,
            ephemeral: true,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            baseInstructions: TITLE_INSTRUCTIONS,
          })
          const threadId = string(object(started.thread).id)
          yield* connection.request('turn/start', {
            threadId,
            input: [{ type: 'text', text: titlePrompt(text), text_elements: [] }],
            effort: 'low',
          })
          let reply = ''
          while (true) {
            const message = yield* Queue.take(connection.messages)
            if (message.id !== undefined) {
              yield* connection.reject(message.id, 'Titling does not use tools')
              continue
            }
            if (message.params.threadId !== threadId) continue
            const item = object(message.params.item)
            if (message.method === 'item/completed' && item.type === 'agentMessage')
              reply = string(item.text)
            if (message.method === 'turn/completed') return normalizeTitle(reply)
          }
        })
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catch(() => Effect.succeed(null))
      )
    return titler
  })
}

import { query } from '@anthropic-ai/claude-agent-sdk'
import { Effect, Stream } from 'effect'

import { normalizeTitle, TITLE_INSTRUCTIONS, titlePrompt, type Titler } from './titler'

const DEFAULT_TITLE_MODEL = 'claude-haiku-4-5'

export function createClaudeTitler(
  model = process.env.JETTY_TITLER_MODEL ?? DEFAULT_TITLE_MODEL
): Titler {
  return (text: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const q = yield* Effect.acquireRelease(
          Effect.try(() =>
            query({
              prompt: titlePrompt(text),
              options: {
                model,
                maxTurns: 1,
                allowedTools: [],
                settingSources: [],
                systemPrompt: TITLE_INSTRUCTIONS,
              },
            })
          ),
          (q) => Effect.try(() => q.close()).pipe(Effect.ignore)
        )

        let resultText: string | null = null
        const messages = {
          [Symbol.asyncIterator]() {
            const iterator = q[Symbol.asyncIterator]()
            return {
              next: () => iterator.next(),
              return() {
                q.close()
                return iterator.return
                  ? iterator.return()
                  : Promise.resolve({ done: true as const, value: undefined })
              },
            }
          },
        }
        yield* Stream.fromAsyncIterable(messages, (error) => error).pipe(
          Stream.runForEach((msg) =>
            Effect.sync(() => {
              if (msg.type === 'result' && msg.subtype === 'success') {
                resultText = msg.result
              }
            })
          )
        )

        return normalizeTitle(resultText)
      })
    ).pipe(Effect.catch(() => Effect.succeed(null)))
}

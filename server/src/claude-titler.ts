import { query } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'

import { normalizeTitle, TITLE_INSTRUCTIONS, titlePrompt, type Titler } from './titler'

export function createClaudeTitler(): Titler {
  const model = process.env.JETTY_TITLER_MODEL ?? 'claude-haiku-4-5'
  return (text) =>
    Effect.acquireUseRelease(
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
      (q) =>
        Effect.tryPromise(async () => {
          let result: string | null = null
          for await (const message of q) {
            if (message.type === 'result' && message.subtype === 'success') result = message.result
          }
          return normalizeTitle(result)
        }),
      (q) => Effect.try(() => q.close()).pipe(Effect.ignore)
    ).pipe(Effect.catch(() => Effect.succeed(null)))
}

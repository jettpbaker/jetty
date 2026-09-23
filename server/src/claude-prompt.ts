import { query } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'

import type { ModelPrompt } from './utility-model'

import { claudeBin } from './claude-bin'

export const claudePrompt: ModelPrompt = (model, effort, instructions, text) =>
  Effect.acquireUseRelease(
    Effect.try(() =>
      query({
        prompt: text,
        options: {
          model: model.id,
          ...(effort ? { effort } : {}),
          pathToClaudeCodeExecutable: claudeBin,
          maxTurns: 1,
          allowedTools: [],
          settingSources: [],
          persistSession: false,
          systemPrompt: instructions,
        },
      })
    ),
    (q) =>
      Effect.tryPromise(async () => {
        let result: string | null = null
        for await (const message of q) {
          if (message.type === 'result' && message.subtype === 'success') result = message.result
        }
        return result
      }),
    (q) => Effect.try(() => q.close()).pipe(Effect.ignore)
  ).pipe(Effect.catch(() => Effect.succeed(null)))

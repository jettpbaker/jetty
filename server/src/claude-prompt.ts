import { query } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'

import type { ModelPrompt } from './title-model'

import { claudeBin } from './claude-bin'

export const claudePrompt: ModelPrompt = (model, effort, _fast, instructions, text) =>
  Effect.acquireUseRelease(
    Effect.try(() =>
      query({
        prompt: text,
        options: {
          model: model.id,
          ...(effort ? { effort } : {}),
          pathToClaudeCodeExecutable: claudeBin,
          maxTurns: 1,
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          settingSources: [],
          persistSession: false,
          systemPrompt: instructions,
        },
      })
    ),
    (q) =>
      Effect.tryPromise({
        try: async () => {
          for await (const message of q) {
            if (message.type !== 'result') continue
            if (message.subtype === 'success' && !message.is_error) return message.result
            throw new Error(
              message.subtype === 'success'
                ? message.result
                : `${message.subtype}: ${message.errors.join('; ')}`
            )
          }
          throw new Error('Claude ended without a result')
        },
        catch: (error) => error,
      }),
    (q) => Effect.try(() => q.close()).pipe(Effect.ignore)
  )

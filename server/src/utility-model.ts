import {
  resolveUtilityModel,
  type ModelRef,
  type ProviderId,
  type ProviderModel,
} from '@jetty/shared/wire'
import { Effect } from 'effect'

import type { StdioProcessOptions } from './stdio-rpc'

import { claudePrompt } from './claude-prompt'
import { createCodexPrompt } from './codex-prompt'
import { createGrokPrompt } from './grok-prompt'

export type ModelPrompt = (
  model: ProviderModel,
  instructions: string,
  text: string
) => Effect.Effect<string | null>

export type UtilityPrompt = (instructions: string, text: string) => Effect.Effect<string | null>

export function createUtilityPrompt(options: {
  codex?: StdioProcessOptions
  grok?: StdioProcessOptions
  catalog: () => Effect.Effect<readonly ProviderModel[]>
  choice: () => Effect.Effect<ModelRef | null>
}) {
  return Effect.gen(function* () {
    const prompts: Record<ProviderId, ModelPrompt> = {
      codex: yield* createCodexPrompt(options.codex),
      claude: claudePrompt,
      grok: yield* createGrokPrompt(options.grok),
    }
    const prompt: UtilityPrompt = (instructions, text) =>
      Effect.gen(function* () {
        const model = resolveUtilityModel(yield* options.choice(), yield* options.catalog())
        if (!model) return null
        return yield* prompts[model.provider](model, instructions, text)
      })
    return prompt
  })
}

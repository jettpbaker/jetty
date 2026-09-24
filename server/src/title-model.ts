import {
  resolveTitleEffort,
  resolveTitleModel,
  type EffortLevel,
  type ProviderId,
  type ProviderModel,
  type TitleModel,
} from '@jetty/shared/wire'
import { Effect } from 'effect'

import type { StdioProcessOptions } from './stdio-rpc'

import { claudePrompt } from './claude-prompt'
import { createCodexPrompt } from './codex-prompt'
import { createGrokPrompt } from './grok-prompt'

export type ModelPrompt = (
  model: ProviderModel,
  effort: EffortLevel | undefined,
  instructions: string,
  text: string
) => Effect.Effect<string | null>

export type TitlePrompt = (instructions: string, text: string) => Effect.Effect<string | null>

export function createTitlePrompt(options: {
  codex?: StdioProcessOptions
  grok?: StdioProcessOptions
  catalog: () => Effect.Effect<readonly ProviderModel[]>
  choice: () => Effect.Effect<TitleModel>
}) {
  return Effect.gen(function* () {
    const prompts: Record<ProviderId, ModelPrompt> = {
      codex: yield* createCodexPrompt(options.codex),
      claude: claudePrompt,
      grok: yield* createGrokPrompt(options.grok),
    }
    const prompt: TitlePrompt = (instructions, text) =>
      Effect.gen(function* () {
        const choice = yield* options.choice()
        const model = resolveTitleModel(choice.model, yield* options.catalog())
        if (!model) return null
        const effort = resolveTitleEffort(model, choice.effort)
        return yield* prompts[model.provider](model, effort, instructions, text)
      })
    return prompt
  })
}

import type { ProviderModel } from '@jetty/shared/wire'

import { query, type ModelInfo, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'

import { claudeBin } from './claude-bin'

const DISCOVERY_TIMEOUT_MS = 20_000

function versionedName(model: ModelInfo) {
  if (/\d/.test(model.displayName)) return model.displayName
  const lead = model.description.split(' · ')[0]?.replace(/ with 1M context$/, '')
  return lead?.startsWith(`${model.displayName} `) && /\d/.test(lead)
    ? lead
    : model.displayName || lead || model.value
}

export function discoverClaudeModels() {
  return Effect.tryPromise(async (signal) => {
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort(), { once: true })
    // The prompt never yields, so the probe never reaches the API.
    const idle = new Promise<IteratorResult<SDKUserMessage>>((resolve) =>
      abortController.signal.addEventListener(
        'abort',
        () => resolve({ done: true, value: undefined }),
        { once: true }
      )
    )
    const probe = query({
      prompt: { [Symbol.asyncIterator]: () => ({ next: () => idle }) },
      options: {
        abortController,
        pathToClaudeCodeExecutable: claudeBin,
        persistSession: false,
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
      },
    })
    try {
      const account = await probe.accountInfo()
      const signedIn =
        account.email ||
        account.apiKeySource ||
        (account.apiProvider ?? 'firstParty') !== 'firstParty'
      if (!signedIn) return []
      const seen = new Set<string>()
      return (await probe.supportedModels()).flatMap((model): ProviderModel[] => {
        const resolved = model.resolvedModel ?? model.value
        if (model.value === 'default' || seen.has(resolved)) return []
        seen.add(resolved)
        return [
          {
            provider: 'claude',
            id: model.value,
            name: versionedName(model),
            efforts: model.supportedEffortLevels ?? [],
            fast: false,
            autoMode: model.supportsAutoMode === true,
          },
        ]
      })
    } finally {
      abortController.abort()
    }
  }).pipe(Effect.timeout(DISCOVERY_TIMEOUT_MS))
}

import type { ProviderModel } from '@jetty/shared/wire'

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'

const DISCOVERY_TIMEOUT_MS = 20_000

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
      return (await probe.supportedModels()).map(
        (model): ProviderModel => ({
          provider: 'claude',
          id: model.value,
          name: model.displayName,
          efforts: model.supportedEffortLevels ?? [],
          fast: false,
        })
      )
    } finally {
      abortController.abort()
    }
  }).pipe(
    Effect.timeout(DISCOVERY_TIMEOUT_MS),
    Effect.orElseSucceed((): ProviderModel[] => [])
  )
}

import type { ProviderUsage } from '@jetty/shared/wire'

import { Effect } from 'effect'

import type { StdioProcessOptions } from './stdio-rpc'

import { isCopilotModel } from './opencode-models'
import { opencodeBin, runOpencode } from './opencode-rpc'

export function readOpencodeProviderUsage(
  home: string,
  options: StdioProcessOptions = {}
): Effect.Effect<ProviderUsage> {
  if (!Bun.which(opencodeBin(options)))
    return Effect.succeed({
      provider: 'opencode',
      connected: false,
      installed: false,
      windows: [],
    } satisfies ProviderUsage)
  return runOpencode(['models'], home, options, 8_000).pipe(
    Effect.map(
      (output) =>
        ({
          provider: 'opencode',
          connected: output
            .split('\n')
            .some((line) => /^\S+\/\S+$/.test(line) && !isCopilotModel(line)),
          installed: true,
          windows: [],
          asOf: Date.now(),
        }) satisfies ProviderUsage
    ),
    Effect.catch(() =>
      Effect.succeed({
        provider: 'opencode',
        connected: false,
        installed: true,
        windows: [],
        failed: true,
      } satisfies ProviderUsage)
    )
  )
}

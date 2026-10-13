import type { ProviderUsage } from '@jetty/shared/wire'

import { Effect } from 'effect'

import { copilotBin, probeCopilotSession } from './copilot-rpc'
import { type StdioProcessOptions } from './stdio-rpc'

export function readCopilotProviderUsage(cwd: string, options: StdioProcessOptions = {}) {
  const missing: ProviderUsage = {
    provider: 'copilot',
    connected: false,
    installed: false,
    windows: [],
  }
  if (!Bun.which(copilotBin(options))) return Effect.succeed(missing)
  return Effect.scoped(
    Effect.gen(function* () {
      yield* probeCopilotSession(cwd, options)
      // ACP exposes context usage, but no account quota API. Never infer limits from token counts.
      return {
        provider: 'copilot',
        connected: true,
        installed: true,
        windows: [],
        asOf: Date.now(),
      } satisfies ProviderUsage
    })
  ).pipe(
    Effect.timeout('8 seconds'),
    Effect.catch((error) =>
      Effect.succeed({
        provider: 'copilot' as const,
        connected: false,
        installed: true,
        windows: [],
        ...(/not.*(?:logged|signed)\s*in|authentication required|login required|unauthenticated/i.test(
          String(error)
        )
          ? {}
          : { failed: true }),
      })
    )
  )
}

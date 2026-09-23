import type { ProviderModel } from '@jetty/shared/wire'

import { EffortLevel } from '@jetty/shared/wire'
import { Effect, Schema } from 'effect'

import { openCodexConnection } from './codex-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

const DISCOVERY_TIMEOUT_MS = 20_000
const isEffort = Schema.is(EffortLevel)

function toProviderModel(raw: Record<string, unknown>): ProviderModel {
  const efforts = Array.isArray(raw.supportedReasoningEfforts)
    ? raw.supportedReasoningEfforts.map((e) => object(e).reasoningEffort).filter(isEffort)
    : []
  const tiers = Array.isArray(raw.serviceTiers) ? raw.serviceTiers.map(object) : []
  const speeds = Array.isArray(raw.additionalSpeedTiers) ? raw.additionalSpeedTiers : []
  return {
    provider: 'codex',
    id: string(raw.model) || string(raw.id),
    name: string(raw.displayName) || string(raw.model),
    efforts,
    ...(isEffort(raw.defaultReasoningEffort) ? { defaultEffort: raw.defaultReasoningEffort } : {}),
    fast:
      speeds.includes('fast') ||
      tiers.some((tier) => tier.id === 'fast' || string(tier.name).toLowerCase() === 'fast'),
    autoMode: true,
  }
}

export function discoverCodexModels(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* openCodexConnection(cwd, options)
      const { account } = yield* connection.request('account/read', {})
      if (!account) return []
      const models: ProviderModel[] = []
      let cursor = ''
      do {
        const page = yield* connection.request('model/list', cursor ? { cursor } : {})
        const data = Array.isArray(page.data) ? page.data.map(object) : []
        for (const raw of data) if (raw.hidden !== true) models.push(toProviderModel(raw))
        cursor = string(page.nextCursor)
      } while (cursor)
      return models.filter((model) => model.id)
    })
  ).pipe(Effect.timeout(DISCOVERY_TIMEOUT_MS))
}

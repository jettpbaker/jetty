import type { ProviderModel } from '@jetty/shared/wire'

import { EffortLevel } from '@jetty/shared/events'
import { Effect, Schema } from 'effect'

import { openCodexConnection } from './codex-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

const DISCOVERY_TIMEOUT_MS = 20_000
const isEffort = Schema.is(EffortLevel)

// Full access is approval `never` with sandbox `danger-full-access`. A policy that drops
// `never` doesn't refuse it: Codex quietly runs it read-only instead.
function allowsFullAccess(requirements: Record<string, unknown>) {
  const sandboxes = requirements.allowedSandboxModes
  const approvals = requirements.allowedApprovalPolicies
  return (
    (!Array.isArray(sandboxes) || sandboxes.includes('danger-full-access')) &&
    (!Array.isArray(approvals) || approvals.includes('never'))
  )
}

function toProviderModel(raw: Record<string, unknown>, fullAccess: boolean): ProviderModel {
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
    fullAccess,
  }
}

export function discoverCodexModels(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* openCodexConnection(cwd, options)
      const { account } = yield* connection.request('account/read', {})
      if (!account) return []
      const { requirements } = yield* connection
        .request('configRequirements/read', undefined)
        .pipe(Effect.orElseSucceed(() => ({ requirements: null })))
      const fullAccess = allowsFullAccess(object(requirements))
      const models: ProviderModel[] = []
      let cursor = ''
      do {
        const page = yield* connection.request('model/list', cursor ? { cursor } : {})
        const data = Array.isArray(page.data) ? page.data.map(object) : []
        for (const raw of data)
          if (raw.hidden !== true) models.push(toProviderModel(raw, fullAccess))
        cursor = string(page.nextCursor)
      } while (cursor)
      return models.filter((model) => model.id)
    })
  ).pipe(Effect.timeout(DISCOVERY_TIMEOUT_MS))
}

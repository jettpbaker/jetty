import type { ProviderModel } from '@jetty/shared/wire'

import { EffortLevel } from '@jetty/shared/wire'
import { Effect, Schema } from 'effect'

import { openGrokConnection } from './grok-rpc'
import { object, string, type StdioProcessOptions } from './stdio-rpc'

const DISCOVERY_TIMEOUT_MS = 20_000
const FAST_SUFFIX = ' Fast'
const isEffort = Schema.is(EffortLevel)

function toProviderModel(raw: Record<string, unknown>): ProviderModel {
  const meta = object(raw._meta)
  const options = Array.isArray(meta.reasoningEfforts) ? meta.reasoningEfforts.map(object) : []
  const offered = new Set(options.map((option) => option.value))
  const defaultEffort = options.find((option) => option.default === true)?.value
  return {
    provider: 'grok',
    id: string(raw.modelId),
    name: string(raw.name) || string(raw.modelId),
    efforts: EffortLevel.literals.filter((level) => offered.has(level)),
    ...(isEffort(defaultEffort) ? { defaultEffort } : {}),
    fast: false,
    autoMode: true,
  }
}

// Grok lists "X Fast" as its own model; Jetty shows it as model X with fast on.
export function foldGrokModels(availableModels: unknown) {
  const all = Array.isArray(availableModels)
    ? availableModels.map((raw) => toProviderModel(object(raw))).filter((model) => model.id)
    : []
  const byName = new Map(all.map((model) => [model.name, model]))
  const fastIds = new Map<string, string>()
  for (const model of all) {
    if (!model.name.endsWith(FAST_SUFFIX)) continue
    const base = byName.get(model.name.slice(0, -FAST_SUFFIX.length))
    if (base) fastIds.set(base.id, model.id)
  }
  const fastVariants = new Set(fastIds.values())
  const models = all
    .filter((model) => !fastVariants.has(model.id))
    .map((model) => (fastIds.has(model.id) ? { ...model, fast: true } : model))
  return { models, fastIds }
}

export function discoverGrokModels(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const { connection, init } = yield* openGrokConnection(
        cwd,
        ['agent', '--no-leader', 'stdio'],
        options
      )
      const advertised = object(object(init._meta).modelState).availableModels
      if (advertised) return foldGrokModels(advertised).models
      const session = yield* connection.request('session/new', { cwd, mcpServers: [] })
      return foldGrokModels(object(session.models).availableModels).models
    })
  ).pipe(
    Effect.timeout(DISCOVERY_TIMEOUT_MS),
    Effect.orElseSucceed((): ProviderModel[] => [])
  )
}

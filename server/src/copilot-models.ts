import type { EffortLevel } from '@jetty/shared/events'
import type { ProviderModel } from '@jetty/shared/wire'

import { EffortLevel as Effort } from '@jetty/shared/events'
import { Effect, Schema } from 'effect'

import { openCopilotConnection } from './copilot-rpc'
import { object, string, type StdioConnection, type StdioProcessOptions } from './stdio-rpc'

export function copilotConfig(session: Record<string, unknown>, category: string, id: string) {
  const options = Array.isArray(session.configOptions) ? session.configOptions.map(object) : []
  return (
    options.find((option) => option.category === category) ??
    options.find((option) => option.id === id)
  )
}

function values(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((raw) => {
        const option = object(raw)
        return Array.isArray(option.options) ? values(option.options) : [option]
      })
    : []
}

export function copilotModels(session: Record<string, unknown>): ProviderModel[] {
  const models = values(copilotConfig(session, 'model', 'model')?.options)
  const available = models.length ? models : values(object(session.models).availableModels)
  const thought = copilotConfig(session, 'thought_level', 'reasoning_effort')
  const offered = new Set(values(thought?.options).map((option) => option.value))
  const efforts = Effort.literals.filter((effort) => offered.has(effort))
  const defaultEffort = thought?.currentValue
  return available
    .filter((model) => object(model._meta).copilotEnablement !== 'disabled')
    .flatMap((model) => {
      const id = string(model.value) || string(model.modelId)
      return id
        ? [
            {
              provider: 'copilot' as const,
              id,
              name: string(model.name) || id,
              efforts,
              ...(Schema.is(Effort)(defaultEffort) ? { defaultEffort } : {}),
              fast: false,
              autoMode: true,
            },
          ]
        : []
    })
}

export function setCopilotModel(
  connection: StdioConnection,
  sessionId: string,
  session: Record<string, unknown>,
  modelId: string,
  effort?: EffortLevel
) {
  return Effect.gen(function* () {
    const config = copilotConfig(session, 'model', 'model')
    const next = config
      ? yield* connection.request('session/set_config_option', {
          sessionId,
          configId: config.id,
          value: modelId,
        })
      : yield* connection.request('session/set_model', { sessionId, modelId })
    const state = Array.isArray(next.configOptions) ? { ...session, ...next } : session
    const thought = copilotConfig(state, 'thought_level', 'reasoning_effort')
    if (effort && thought) {
      const result = yield* connection.request('session/set_config_option', {
        sessionId,
        configId: thought.id,
        value: effort,
      })
      return Array.isArray(result.configOptions) ? { ...state, ...result } : state
    }
    return state
  })
}

export function discoverCopilotModels(cwd: string, options: StdioProcessOptions = {}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const { connection } = yield* openCopilotConnection(cwd, options)
      const session = yield* connection.request('session/new', { cwd, mcpServers: [] })
      const sessionId = string(session.sessionId)
      const models: ProviderModel[] = []
      // Reasoning choices change with the selected model. Configuration requests do not run turns.
      for (const model of copilotModels(session)) {
        const state = yield* setCopilotModel(connection, sessionId, session, model.id)
        models.push(copilotModels(state).find((candidate) => candidate.id === model.id) ?? model)
      }
      return models
    })
  ).pipe(Effect.timeout('20 seconds'))
}

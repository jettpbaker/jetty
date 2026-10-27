import type { EffortLevel } from '@jetty/shared/events'
import type { ProviderModel } from '@jetty/shared/wire'

import { EffortLevel as Effort } from '@jetty/shared/events'
import { Effect } from 'effect'

import { AgentError } from './agent'
import { runOpencode } from './opencode-rpc'
import { object, string, type StdioConnection, type StdioProcessOptions } from './stdio-rpc'

// Copilot has its own provider, so OpenCode never routes to it.
export function isCopilotModel(id: string) {
  return id.startsWith('github-copilot/')
}

export function opencodeConfig(session: Record<string, unknown>, category: string, id: string) {
  const options = Array.isArray(session.configOptions) ? session.configOptions.map(object) : []
  return (
    options.find((option) => option.category === category) ??
    options.find((option) => option.id === id)
  )
}

export function setOpencodeModel(
  connection: StdioConnection,
  sessionId: string,
  session: Record<string, unknown>,
  modelId: string,
  effort?: EffortLevel
) {
  return Effect.gen(function* () {
    if (isCopilotModel(modelId))
      return yield* Effect.fail(
        new AgentError('GitHub Copilot models are not used through OpenCode')
      )
    const config = opencodeConfig(session, 'model', 'model')
    if (!config) return yield* Effect.fail(new AgentError('OpenCode did not advertise a model'))
    const next = yield* connection.request('session/set_config_option', {
      sessionId,
      configId: config.id,
      value: modelId,
    })
    const state = Array.isArray(next.configOptions) ? { ...session, ...next } : session
    const thought = opencodeConfig(state, 'thought_level', 'effort')
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

// `opencode models --verbose` prints a `provider/model` line, then that model's JSON.
export function parseOpencodeModels(output: string): ProviderModel[] {
  const models: ProviderModel[] = []
  let heading = ''
  let body: string[] = []
  function flush() {
    if (!heading) return
    let info: Record<string, unknown> = {}
    try {
      info = object(JSON.parse(body.join('\n')))
    } catch {
      // A model with unreadable details is still selectable.
    }
    const providerId = string(info.providerID)
    const variants = Object.keys(object(info.variants))
    if (!isCopilotModel(heading) && info.status !== 'deprecated')
      models.push({
        provider: 'opencode',
        id: heading,
        name: string(info.name)
          ? providerId && providerId !== 'opencode'
            ? `${string(info.name)} (${providerId})`
            : string(info.name)
          : heading,
        efforts: Effort.literals.filter((effort) => variants.includes(effort)),
        fast: false,
        autoMode: true,
      })
  }
  for (const line of output.split('\n')) {
    if (/^[^\s{}"]+\/\S+$/.test(line)) {
      flush()
      heading = line.trim()
      body = []
    } else if (heading) body.push(line)
  }
  flush()
  return models
}

export function discoverOpencodeModels(cwd: string, options: StdioProcessOptions = {}) {
  return runOpencode(['models', '--verbose'], cwd, options).pipe(Effect.map(parseOpencodeModels))
}

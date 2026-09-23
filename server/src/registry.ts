import type { Effect } from 'effect'

import type { Agent } from './agent'

/** Echo is the in-process test double. It is never a client-selected provider. */
export type AgentProvider = 'claude' | 'codex' | 'grok' | 'echo'

export type AgentRegistry = {
  readonly defaultProvider: AgentProvider
  agent(provider: AgentProvider): Agent | undefined
}

export type ProviderTitler = (provider: AgentProvider, text: string) => Effect.Effect<string | null>

export function isAgentProvider(value: string): value is AgentProvider {
  return value === 'claude' || value === 'codex' || value === 'grok' || value === 'echo'
}

export function singleAgentRegistry(agent: Agent, provider: AgentProvider = 'echo'): AgentRegistry {
  return {
    defaultProvider: provider,
    agent(name) {
      return name === provider ? agent : undefined
    },
  }
}

export function agentRegistry(
  agents: Record<Exclude<AgentProvider, 'echo'>, Agent>,
  defaultProvider: Exclude<AgentProvider, 'echo'>
): AgentRegistry {
  return {
    defaultProvider,
    agent(provider) {
      if (provider === 'echo') return undefined
      return agents[provider]
    },
  }
}

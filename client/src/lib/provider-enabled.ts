import { storage } from '@/platform'

// Settings' provider switches. Kept out of the Settings chunk: Usage reads them in the background.
export type ProviderEnabled = Record<'claude' | 'codex' | 'grok' | 'copilot', boolean>

const enabledKey = 'jetty.provider-enabled'

export function loadProviderEnabled(): ProviderEnabled {
  const enabled = { claude: true, codex: true, grok: true, copilot: true }
  try {
    const saved = JSON.parse(storage.get(enabledKey) ?? '{}')
    for (const id of ['claude', 'codex', 'grok', 'copilot'] as const)
      if (typeof saved?.[id] === 'boolean') enabled[id] = saved[id]
  } catch {
    return enabled
  }
  return enabled
}

export function saveProviderEnabled(enabled: ProviderEnabled) {
  storage.set(enabledKey, JSON.stringify(enabled))
}

export type LoadoutModel = {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'xai'
  efforts: readonly string[]
  fast: boolean
}

export type Loadout = {
  id: string
  model: string
  effort: string
  fast: boolean
}

export type LoadoutSlot = Omit<Loadout, 'model'> & { model: string | null }

function emptySlot(id: string): LoadoutSlot {
  return { id, model: null, effort: 'high', fast: false }
}

export const loadoutCatalog: readonly LoadoutModel[] = [
  {
    id: 'fable-5.1',
    name: 'Fable 5.1',
    provider: 'anthropic',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    fast: false,
  },
  {
    id: 'opus-5',
    name: 'Opus 5',
    provider: 'anthropic',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    fast: false,
  },
  {
    id: 'sonnet-5',
    name: 'Sonnet 5',
    provider: 'anthropic',
    efforts: ['low', 'medium', 'high'],
    fast: false,
  },
  {
    id: 'haiku-5',
    name: 'Haiku 5',
    provider: 'anthropic',
    efforts: ['low', 'medium', 'high'],
    fast: false,
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    provider: 'openai',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    fast: true,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    provider: 'openai',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    fast: true,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'openai',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    fast: true,
  },
  {
    id: 'grok-4.5',
    name: 'Grok 4.5',
    provider: 'xai',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    fast: true,
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    provider: 'xai',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    fast: true,
  },
]
export const copilotModels = ['GPT-6 Astra', 'Claude Sonnet 5', 'Gemini 3.8 Flash', 'Grok 4.6']

export function findModel(id: string | null) {
  return loadoutCatalog.find((model) => model.id === id)
}

export const defaultLoadouts: Loadout[] = [
  { id: 'slot-1', model: 'opus-5', effort: 'high', fast: false },
  { id: 'slot-2', model: 'gpt-6-astra', effort: 'low', fast: true },
  { id: 'slot-3', model: 'fable-5.1', effort: 'medium', fast: false },
  { id: 'slot-4', model: 'grok-4.6', effort: 'medium', fast: false },
  { id: 'slot-5', model: 'gpt-5.6-sol', effort: 'high', fast: false },
]
export const effortLabels: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}
export function equipModel(slot: LoadoutSlot, model: LoadoutModel): Loadout {
  const effort = model.efforts.includes(slot.effort) ? slot.effort : 'high'
  return { ...slot, model: model.id, effort, fast: model.fast && slot.fast }
}
export function restoreLoadouts(value: unknown): LoadoutSlot[] {
  if (!Array.isArray(value) || value.length !== defaultLoadouts.length) return defaultLoadouts
  return defaultLoadouts.map((fallback, index) => {
    const item = value[index]
    if (!item || typeof item !== 'object') return fallback
    if (item.model === null) return emptySlot(fallback.id)
    const model = findModel(item.model)
    if (!model) return fallback
    return equipModel(
      {
        id: fallback.id,
        model: model.id,
        effort: typeof item.effort === 'string' ? item.effort : 'high',
        fast: item.fast === true,
      },
      model
    )
  })
}

export function clearSlot(slots: LoadoutSlot[], id: string) {
  return slots.map((slot) => (slot.id === id ? emptySlot(id) : slot))
}

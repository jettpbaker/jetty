import {
  BatteryEmptyIcon,
  BatteryLowIcon,
  BatteryMedium01Icon,
  BatteryMedium02Icon,
  BatteryFullIcon,
} from '@/components/custom/huge_icons'
import { EffortLevel } from '@jetty/shared/events'
import { findProviderModel } from '@jetty/shared/model-name'
import { ProviderId, type ProviderModel } from '@jetty/shared/wire'
import { Schema } from 'effect'

export type Loadout = {
  provider: ProviderId
  model: string
  effort?: EffortLevel
  fast: boolean
}

export type LoadoutSlot = Omit<Loadout, 'model'> & { id: string; model: string | null }

const slotCount = 5
const isProvider = Schema.is(ProviderId)
const isEffort = Schema.is(EffortLevel)

export const effortIcons = {
  low: BatteryEmptyIcon,
  medium: BatteryLowIcon,
  high: BatteryMedium01Icon,
  xhigh: BatteryMedium02Icon,
  max: BatteryFullIcon,
} satisfies Record<EffortLevel, typeof BatteryEmptyIcon>

export const effortLabels: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

export const copilotModels = ['GPT-6 Astra', 'Claude Sonnet 5', 'Gemini 3.8 Flash', 'Grok 4.6']

export function modelKey(model: { provider: ProviderId; id: string }) {
  return `${model.provider}:${model.id}`
}

export function findModel(
  catalog: readonly ProviderModel[],
  loadout: { provider: ProviderId; model: string | null }
) {
  return findProviderModel(catalog, loadout.provider, loadout.model)
}

export function fitEffort(model: ProviderModel, effort?: EffortLevel) {
  if (effort && model.efforts.includes(effort)) return effort
  if (model.defaultEffort) return model.defaultEffort
  return model.efforts.includes('high') ? 'high' : model.efforts.at(-1)
}

export function equipModel<T extends { fast: boolean; effort?: EffortLevel }>(
  slot: T,
  model: ProviderModel
) {
  return {
    ...slot,
    provider: model.provider,
    model: model.id,
    effort: fitEffort(model, slot.effort),
    fast: model.fast && slot.fast,
  }
}

// Same loadout, counting a pinned model and the alias that currently resolves to it as one.
export function sameLoadoutIn(catalog: readonly ProviderModel[], a: Loadout, b: Loadout) {
  if (a.provider !== b.provider || a.effort !== b.effort || a.fast !== b.fast) return false
  if (a.model === b.model) return true
  const model = findModel(catalog, a)
  return model !== undefined && model === findModel(catalog, b)
}

export function describeLoadout({ effort, fast }: { effort?: EffortLevel; fast: boolean }) {
  return [effort && effortLabels[effort], fast && 'Fast'].filter(Boolean).join(' ')
}

function emptySlot(id: string): LoadoutSlot {
  return { id, provider: 'claude', model: null, fast: false }
}

function slotId(index: number) {
  return `slot-${index + 1}`
}

function emptyLoadouts() {
  return Array.from({ length: slotCount }, (_, index) => emptySlot(slotId(index)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function restoreLoadouts(value: unknown, catalog: readonly ProviderModel[]): LoadoutSlot[] {
  const fallback = emptyLoadouts()
  if (!Array.isArray(value) || value.length !== slotCount) return fallback
  return fallback.map((slot, index) => {
    const item: unknown = value[index]
    if (!isRecord(item)) return slot
    const id = typeof item.id === 'string' ? item.id : slot.id
    if (item.model === null) return emptySlot(id)
    const model =
      typeof item.provider === 'string' && typeof item.model === 'string'
        ? findProviderModel(catalog, item.provider, item.model)
        : undefined
    if (!model) {
      if (!isProvider(item.provider) || typeof item.model !== 'string') return { ...slot, id }
      const effort = isEffort(item.effort) ? item.effort : undefined
      return { id, provider: item.provider, model: item.model, effort, fast: item.fast === true }
    }
    const effort = model.efforts.find((level) => level === item.effort)
    return equipModel({ id, effort, fast: item.fast === true }, model)
  })
}

export function clearSlot(slots: readonly LoadoutSlot[], id: string) {
  return slots.map((slot) => (slot.id === id ? emptySlot(id) : slot))
}

export function slotLoadout(slot: LoadoutSlot): Loadout | undefined {
  const { model, provider, effort, fast } = slot
  return model === null ? undefined : { provider, model, effort, fast }
}

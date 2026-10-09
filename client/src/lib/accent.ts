import { storage } from '@/platform'

// The bots' face colours, in their order.
export const accentPresets = [
  { value: 'coral', label: 'Coral' },
  { value: 'orange', label: 'Orange' },
  { value: 'butter', label: 'Butter' },
  { value: 'mint', label: 'Mint' },
  { value: 'teal', label: 'Teal' },
  { value: 'blue', label: 'Blue' },
  { value: 'lilac', label: 'Lilac' },
  { value: 'rose', label: 'Rose' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'slate', label: 'Slate' },
] as const

export type Accent = (typeof accentPresets)[number]['value']
export const accentStorageKey = 'jetty.accent'

export function isAccent(value: unknown): value is Accent {
  return accentPresets.some((preset) => preset.value === value)
}

export function loadAccent(): Accent {
  const saved = storage.get(accentStorageKey)
  return isAccent(saved) ? saved : 'lilac'
}

export const accentChangeEvent = 'jetty-accent'

export function notifyAccentChange() {
  window.dispatchEvent(new Event(accentChangeEvent))
}

export function setAccent(value: Accent) {
  const root = document.documentElement
  root.style.removeProperty('--accent-primary-light')
  root.style.removeProperty('--accent-primary-dark')
  root.style.removeProperty('--accent-primary-oled')
  root.style.removeProperty('--tint-h')
  root.style.removeProperty('--tint-c')
  delete root.dataset.accentFrom
  root.dataset.accent = value
  storage.set(accentStorageKey, value)
  notifyAccentChange()
}

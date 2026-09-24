import { storage } from '@/platform'

export const accentPresets = [
  { value: 'lilac', label: 'Lilac' },
  { value: 'blue', label: 'Blue' },
  { value: 'teal', label: 'Teal' },
  { value: 'rose', label: 'Rose' },
  { value: 'orange', label: 'Orange' },
] as const

export type Accent = (typeof accentPresets)[number]['value']
const storageKey = 'jetty.accent'

export function isAccent(value: unknown): value is Accent {
  return accentPresets.some((preset) => preset.value === value)
}

export function loadAccent(): Accent {
  const saved = storage.get(storageKey)
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
  root.style.removeProperty('--tint-h')
  root.style.removeProperty('--tint-c')
  delete root.dataset.accentFrom
  root.dataset.accent = value
  storage.set(storageKey, value)
  notifyAccentChange()
}

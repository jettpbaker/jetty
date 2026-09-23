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
  try {
    const saved = storage.get(storageKey)
    return isAccent(saved) ? saved : 'lilac'
  } catch {
    return 'lilac'
  }
}

export const accentChangeEvent = 'jetty-accent'

export function notifyAccentChange() {
  window.dispatchEvent(new Event(accentChangeEvent))
}

export function setAccent(value: Accent) {
  const root = document.documentElement
  root.style.removeProperty('--accent-primary-light')
  root.style.removeProperty('--accent-primary-dark')
  delete root.dataset.accentFrom
  root.dataset.accent = value
  try {
    storage.set(storageKey, value)
  } catch {
    /* Storage may be disabled. */
  }
  notifyAccentChange()
}

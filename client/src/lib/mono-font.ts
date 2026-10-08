import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

export const monoFonts = [
  { value: 'geist', label: 'Geist Mono' },
  { value: 'paper', label: 'Paper Mono' },
] as const

export type MonoFont = (typeof monoFonts)[number]['value']

const key = 'jetty.monoFont'
const changeEvent = 'jetty-mono-font'

export function isMonoFont(value: unknown): value is MonoFont {
  return monoFonts.some((font) => font.value === value)
}

export function loadMonoFont(): MonoFont {
  const saved = storage.get(key)
  return isMonoFont(saved) ? saved : 'geist'
}

export function applyMonoFont(font = loadMonoFont()) {
  document.documentElement.dataset.mono = font
}

export function setMonoFont(font: MonoFont) {
  storage.set(key, font)
  applyMonoFont(font)
  window.dispatchEvent(new Event(changeEvent))
}

// A choice made in another window applies here too.
export function followMonoFont() {
  window.addEventListener('storage', (event) => {
    if (event.key !== key) return
    applyMonoFont()
    window.dispatchEvent(new Event(changeEvent))
  })
}

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange)
  return () => window.removeEventListener(changeEvent, onChange)
}

export function useMonoFont() {
  return useSyncExternalStore(subscribe, loadMonoFont)
}

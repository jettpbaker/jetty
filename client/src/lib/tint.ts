import { storage } from '@/platform'

const key = 'jetty.tintStrength'

export const tintStrengths = ['0', '0.25', '0.5', '0.75', '1', '1.5'] as const
export type TintStrength = (typeof tintStrengths)[number]

function isTintStrength(value: unknown): value is TintStrength {
  return tintStrengths.includes(value as TintStrength)
}

export function loadTintStrength(): TintStrength {
  const saved = storage.get(key)
  return isTintStrength(saved) ? saved : '0'
}

export function applyTintStrength(value = loadTintStrength()) {
  document.documentElement.style.setProperty('--tint-strength', value)
}

export function setTintStrength(value: string) {
  if (!isTintStrength(value)) return
  storage.set(key, value)
  applyTintStrength(value)
}

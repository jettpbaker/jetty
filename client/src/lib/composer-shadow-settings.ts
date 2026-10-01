import { storage } from '@/platform'

export type ComposerShadowSettings = {
  enabled: boolean
  strength: number
  falloffPx: number
}

export const initialComposerShadowSettings: ComposerShadowSettings = {
  enabled: true,
  strength: 5,
  falloffPx: 480,
}

// Light mode only; the colour itself lives in index.css (--composer-shadow-color).
export type LightComposerShadow = 'faint' | 'tinted'
const storageKey = 'jetty.composer-shadow'

export function loadLightComposerShadow(): LightComposerShadow {
  return storage.get(storageKey) === 'tinted' ? 'tinted' : 'faint'
}

export function setLightComposerShadow(value: LightComposerShadow) {
  document.documentElement.dataset.composerShadow = value
  storage.set(storageKey, value)
}

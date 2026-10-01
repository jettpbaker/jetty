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

// Temporary comparison for light mode: how the shadow is drawn, and whether it takes the accent hue.
export type ComposerShadowLook = { technique: 'gradient' | 'blur' | 'off'; tinted: boolean }
const storageKey = 'jetty.composer-shadow-look'

export function loadComposerShadowLook(): ComposerShadowLook {
  const [technique, tint] = (storage.get(storageKey) ?? '').split(':')
  return {
    technique: technique === 'blur' || technique === 'off' ? technique : 'gradient',
    tinted: tint === 'tinted',
  }
}

export function applyComposerShadowLook(look: ComposerShadowLook) {
  document.documentElement.dataset.composerShadow = look.technique
  document.documentElement.dataset.composerShadowTint = look.tinted ? 'tinted' : 'plain'
}

export function setComposerShadowLook(look: ComposerShadowLook) {
  applyComposerShadowLook(look)
  storage.set(storageKey, `${look.technique}:${look.tinted ? 'tinted' : 'plain'}`)
}

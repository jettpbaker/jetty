export type ComposerShadowSettings = {
  enabled: boolean
  opacity: number
  strength: number
  falloffPx: number
}

export const initialComposerShadowSettings: ComposerShadowSettings = {
  enabled: true,
  opacity: 0.7,
  strength: 5,
  falloffPx: 480,
}

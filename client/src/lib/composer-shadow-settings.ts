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

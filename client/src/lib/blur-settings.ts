export type BlurSettings = {
  enabled: boolean
  topPx: number
  bottomPx: number
}

export const initialBlurSettings: BlurSettings = {
  enabled: true,
  topPx: 0.3,
  bottomPx: 6,
}

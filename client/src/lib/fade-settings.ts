import type { CurveSettings } from './vertical-curve'

export type FadeSettings = CurveSettings & {
  enabled: boolean
  topOpacity: number
  bottomOpacity: number
}

export const initialFadeSettings: FadeSettings = {
  enabled: true,
  topOpacity: 0.7,
  bottomOpacity: 0,
  curveStart: 0.35,
  curveStrength: 2.5,
}

export const videoFadeSettings: FadeSettings = {
  enabled: true,
  topOpacity: 1,
  bottomOpacity: 0.5,
  curveStart: 0.6,
  curveStrength: 2.5,
}

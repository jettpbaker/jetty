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

import type { FadeSettings } from './fade-settings'

import { curveMask } from './vertical-curve'

export function opacityMask(settings: FadeSettings) {
  return settings.enabled
    ? curveMask(settings, settings.topOpacity, settings.bottomOpacity)
    : 'none'
}

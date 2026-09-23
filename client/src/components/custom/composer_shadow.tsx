import type { ComposerShadowSettings } from '@/lib/composer-shadow-settings'

import './composer_shadow.css'

export function ComposerShadow({ settings }: { settings: ComposerShadowSettings }) {
  if (!settings.enabled) return null
  const inset = Math.min(settings.falloffPx * 0.1, 8)
  const layer = `0 0 ${settings.falloffPx}px ${-inset}px rgb(0 0 0 / ${settings.opacity})`
  const boxShadow = Array.from({ length: settings.strength }, () => layer).join(', ')

  return <div className='composer-shadow' aria-hidden='true' style={{ boxShadow }} />
}

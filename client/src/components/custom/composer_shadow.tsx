import type { ComposerShadowSettings } from '@/lib/composer-shadow-settings'

import { useAppearance } from '@/lib/appearance'

import './composer_shadow.css'

export function ComposerShadow({ settings }: { settings: ComposerShadowSettings }) {
  const { wallpaper, video } = useAppearance()
  if (!settings.enabled) return null
  const inset = Math.min(settings.falloffPx * 0.1, 8)
  const layer = `0 0 ${settings.falloffPx}px ${-inset}px var(--composer-shadow-color)`
  const boxShadow = Array.from({ length: settings.strength }, () => layer).join(', ')

  return (
    <div
      className='composer-shadow'
      data-wallpaper={wallpaper || video ? '' : undefined}
      aria-hidden='true'
      style={{ '--composer-box-shadow': boxShadow } as React.CSSProperties}
    />
  )
}

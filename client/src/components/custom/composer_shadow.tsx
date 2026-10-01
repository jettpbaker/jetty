import type { ComposerShadowSettings } from '@/lib/composer-shadow-settings'

import { useAppearance } from '@/lib/appearance'

import './composer_shadow.css'

// Whether the heavy shadow lifts the composer off a wallpaper; otherwise its own small lift does.
export function useWallpaperUnderComposer() {
  const { wallpaper, video } = useAppearance()
  return !!(wallpaper || video)
}

export function ComposerShadow({ settings }: { settings: ComposerShadowSettings }) {
  const underneath = useWallpaperUnderComposer()
  if (!settings.enabled || !underneath) return null
  const inset = Math.min(settings.falloffPx * 0.1, 8)
  const layer = `0 0 ${settings.falloffPx}px ${-inset}px var(--composer-shadow-color)`
  const boxShadow = Array.from({ length: settings.strength }, () => layer).join(', ')

  return (
    <div
      className='composer-shadow'
      aria-hidden='true'
      style={{ '--composer-box-shadow': boxShadow } as React.CSSProperties}
    />
  )
}

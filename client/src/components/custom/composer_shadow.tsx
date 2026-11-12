import { useAppearance } from '@/lib/appearance'

import './composer_shadow.css'

const strength = 5
const falloffPx = 480
const inset = Math.min(falloffPx * 0.1, 8)
const layer = `0 0 ${falloffPx}px ${-inset}px var(--composer-shadow-color)`
const boxShadow = Array.from({ length: strength }, () => layer).join(', ')

// Whether the heavy shadow lifts the composer off a wallpaper; otherwise its own small lift does.
export function useWallpaperUnderComposer() {
  const { wallpaper, video } = useAppearance()
  return !!(wallpaper || video)
}

export function ComposerShadow() {
  const underneath = useWallpaperUnderComposer()
  if (!underneath) return null

  return (
    <div
      className='composer-shadow'
      aria-hidden='true'
      style={{ '--composer-box-shadow': boxShadow } as React.CSSProperties}
    />
  )
}

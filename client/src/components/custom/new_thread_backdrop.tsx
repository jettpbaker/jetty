import { useAppearance } from '@/lib/appearance'
import { initialBlurSettings } from '@/lib/blur-settings'
import { initialDitherSettings } from '@/lib/dither-settings'
import { initialFadeSettings, videoFadeSettings } from '@/lib/fade-settings'
import { useResolvedTheme } from '@/lib/theme'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

import { DitherDrift } from './dither_drift'
import { DownwardBlur } from './downward_blur'
import { DriftingDither } from './drifting_dither'
import { OpacityFade } from './opacity_fade'
import { ComposerFade, useWallpaperFade } from './wallpaper_fade_study'
import './new_thread_backdrop.css'

const curve = {
  curveStart: initialFadeSettings.curveStart,
  curveStrength: initialFadeSettings.curveStrength,
}

function WallpaperVideo({ src, playing }: { src: string; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (playing) void video.play().catch(() => {})
    else video.pause()
  }, [playing, src])
  return <video ref={ref} className='wallpaper' src={src} muted loop playsInline />
}

export function NewThreadBackdrop({ visible }: { visible: boolean }) {
  const { wallpaper: image, video } = useAppearance()
  const resolvedTheme = useResolvedTheme()
  const reducedMotion = useReducedMotion()
  const studied = useWallpaperFade()
  if (!image && !video) return <DitherDrift />
  const fadeBackground = resolvedTheme === 'light' ? '#ffffff' : '#000000'
  // Clean is light-only; Jett compares in both themes.
  const fade = video || (resolvedTheme === 'dark' && studied === 'clean') ? 'current' : studied
  const wallpaper = (
    <DriftingDither
      className='wallpaper'
      image={image}
      {...initialDitherSettings}
      offsetX={0}
      offsetY={0}
      drift={0}
    />
  )
  if (fade === 'clean')
    return (
      <div className='pointer-events-none absolute inset-0 overflow-hidden' aria-hidden='true'>
        <ComposerFade>{wallpaper}</ComposerFade>
      </div>
    )
  return (
    <div className='pointer-events-none absolute inset-0 overflow-hidden' aria-hidden='true'>
      {video ? (
        <OpacityFade settings={videoFadeSettings} background={fadeBackground}>
          <WallpaperVideo src={video} playing={visible && !reducedMotion} />
        </OpacityFade>
      ) : (
        <OpacityFade
          settings={
            fade === 'jett' ? { ...initialFadeSettings, topOpacity: 1 } : initialFadeSettings
          }
          background={fadeBackground}
        >
          <DownwardBlur settings={initialBlurSettings} curve={curve}>
            {wallpaper}
          </DownwardBlur>
        </OpacityFade>
      )}
    </div>
  )
}

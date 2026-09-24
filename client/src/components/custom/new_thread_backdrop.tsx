import { useAppearance } from '@/lib/appearance'
import { initialBlurSettings } from '@/lib/blur-settings'
import { initialDitherSettings } from '@/lib/dither-settings'
import { initialFadeSettings } from '@/lib/fade-settings'
import { useResolvedTheme } from '@/lib/theme'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

import { DownwardBlur } from './downward_blur'
import { DriftingDither } from './drifting_dither'
import { OpacityFade } from './opacity_fade'
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
  if (!image && !video) return null
  const fadeBackground = resolvedTheme === 'light' ? '#ffffff' : '#000000'
  return (
    <div className='pointer-events-none absolute inset-0 overflow-hidden' aria-hidden='true'>
      <OpacityFade settings={initialFadeSettings} background={fadeBackground}>
        <DownwardBlur settings={initialBlurSettings} curve={curve}>
          {video ? (
            <WallpaperVideo src={video} playing={visible && !reducedMotion} />
          ) : (
            <DriftingDither
              className='wallpaper'
              image={image}
              {...initialDitherSettings}
              offsetX={0}
              offsetY={0}
              drift={0}
            />
          )}
        </DownwardBlur>
      </OpacityFade>
    </div>
  )
}

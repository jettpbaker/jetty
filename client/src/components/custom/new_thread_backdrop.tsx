import { useAppearance } from '@/lib/appearance'
import { initialBlurSettings } from '@/lib/blur-settings'
import { initialDitherSettings } from '@/lib/dither-settings'
import { initialFadeSettings } from '@/lib/fade-settings'
import { useResolvedTheme } from '@/lib/theme'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

import { DitherDrift } from './dither_drift'
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

let webgl: boolean | undefined

// Paper Shaders need WebGL 2, and throw from an effect where nothing can catch it.
function hasWebGL() {
  if (webgl === undefined) {
    const gl = document.createElement('canvas').getContext('webgl2')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    webgl = gl !== null
  }
  return webgl
}

export function NewThreadBackdrop({ visible }: { visible: boolean }) {
  const { wallpaper: image, video } = useAppearance()
  const resolvedTheme = useResolvedTheme()
  const reducedMotion = useReducedMotion()
  const light = resolvedTheme === 'light'
  const fadeBackground = light ? '#ffffff' : '#000000'
  const fade = { ...initialFadeSettings, topOpacity: light ? 0.9 : 0.8 }
  if (!image && !video)
    return hasWebGL() ? (
      <OpacityFade settings={fade} background={fadeBackground}>
        <DitherDrift />
      </OpacityFade>
    ) : null
  return (
    <div className='pointer-events-none absolute inset-0 overflow-hidden' aria-hidden='true'>
      {video ? (
        <OpacityFade settings={fade} background={fadeBackground}>
          <WallpaperVideo src={video} playing={visible && !reducedMotion} />
        </OpacityFade>
      ) : (
        <OpacityFade settings={fade} background={fadeBackground}>
          <DownwardBlur settings={initialBlurSettings} curve={curve}>
            {hasWebGL() ? (
              <DriftingDither
                className='wallpaper'
                image={image}
                {...initialDitherSettings}
                offsetX={0}
                offsetY={0}
                drift={0}
              />
            ) : (
              <img className='wallpaper' src={image} alt='' />
            )}
          </DownwardBlur>
        </OpacityFade>
      )}
    </div>
  )
}

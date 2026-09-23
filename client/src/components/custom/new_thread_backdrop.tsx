import { useAppearance } from '@/lib/appearance'
import { initialBlurSettings } from '@/lib/blur-settings'
import { initialDitherSettings } from '@/lib/dither-settings'
import { initialFadeSettings } from '@/lib/fade-settings'
import { useResolvedTheme } from '@/lib/theme'

import { DownwardBlur } from './downward_blur'
import { DriftingDither } from './drifting_dither'
import { OpacityFade } from './opacity_fade'
import './new_thread_backdrop.css'

const curve = {
  curveStart: initialFadeSettings.curveStart,
  curveStrength: initialFadeSettings.curveStrength,
}

export function NewThreadBackdrop() {
  const { wallpaper: image } = useAppearance()
  const resolvedTheme = useResolvedTheme()
  if (!image) return null
  const fadeBackground = resolvedTheme === 'light' ? '#ffffff' : '#000000'
  return (
    <div className='pointer-events-none absolute inset-0 overflow-hidden' aria-hidden='true'>
      <OpacityFade settings={initialFadeSettings} background={fadeBackground}>
        <DownwardBlur settings={initialBlurSettings} curve={curve}>
          <DriftingDither
            className='wallpaper'
            image={image}
            {...initialDitherSettings}
            offsetX={0}
            offsetY={0}
            drift={0}
          />
        </DownwardBlur>
      </OpacityFade>
    </div>
  )
}

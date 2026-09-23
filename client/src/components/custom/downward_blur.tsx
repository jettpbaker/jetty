import type { BlurSettings } from '@/lib/blur-settings'
import type { ReactNode } from 'react'

import { curveMask, type CurveSettings } from '@/lib/vertical-curve'

type DownwardBlurProps = {
  settings: BlurSettings
  curve: CurveSettings
  children: ReactNode
}

export function DownwardBlur({ settings, curve, children }: DownwardBlurProps) {
  const top = settings.enabled ? settings.topPx : 0
  const additionalBlur = Math.sqrt(Math.max(0, settings.bottomPx ** 2 - top ** 2))
  const gradient = curveMask(curve, 0, 1)

  return (
    <div className='background-stack' aria-hidden='true'>
      <div className='background-filter' style={{ filter: top > 0 ? `blur(${top}px)` : 'none' }}>
        {children}
      </div>
      {settings.enabled && additionalBlur > 0 && (
        <div
          className='downward-blur'
          style={{
            backdropFilter: `blur(${additionalBlur}px)`,
            WebkitBackdropFilter: `blur(${additionalBlur}px)`,
            maskImage: gradient,
            WebkitMaskImage: gradient,
          }}
        />
      )}
    </div>
  )
}

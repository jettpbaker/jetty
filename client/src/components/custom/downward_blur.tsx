import type { ReactNode } from 'react'

import { curveMask, type CurveSettings } from '@/lib/vertical-curve'

const topPx = 0.3
const bottomPx = 6
const additionalBlur = Math.sqrt(bottomPx ** 2 - topPx ** 2)

type DownwardBlurProps = {
  curve: CurveSettings
  children: ReactNode
}

export function DownwardBlur({ curve, children }: DownwardBlurProps) {
  const gradient = curveMask(curve, 0, 1)

  return (
    <div className='background-stack' aria-hidden='true'>
      <div className='background-filter' style={{ filter: `blur(${topPx}px)` }}>
        {children}
      </div>
      <div
        className='downward-blur'
        style={{
          backdropFilter: `blur(${additionalBlur}px)`,
          WebkitBackdropFilter: `blur(${additionalBlur}px)`,
          maskImage: gradient,
          WebkitMaskImage: gradient,
        }}
      />
    </div>
  )
}

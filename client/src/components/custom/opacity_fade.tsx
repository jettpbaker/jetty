import type { ReactNode } from 'react'

import { curveMask, type CurveSettings } from '@/lib/vertical-curve'

type OpacityFadeProps = {
  curve: CurveSettings
  topOpacity: number
  background: string
  children: ReactNode
}

export function OpacityFade({ curve, topOpacity, background, children }: OpacityFadeProps) {
  const mask = curveMask(curve, topOpacity, 0)

  return (
    <div className='background-stack' style={{ background }} aria-hidden='true'>
      <div className='background-fade' style={{ maskImage: mask, WebkitMaskImage: mask }}>
        {children}
      </div>
    </div>
  )
}

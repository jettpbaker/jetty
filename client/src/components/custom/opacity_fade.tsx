import type { FadeSettings } from '@/lib/fade-settings'
import type { ReactNode } from 'react'

import { opacityMask } from '@/lib/opacity-curve'

type OpacityFadeProps = {
  settings: FadeSettings
  background: string
  children: ReactNode
}

export function OpacityFade({ settings, background, children }: OpacityFadeProps) {
  const mask = opacityMask(settings)

  return (
    <div className='background-stack' style={{ background }} aria-hidden='true'>
      <div className='background-fade' style={{ maskImage: mask, WebkitMaskImage: mask }}>
        {children}
      </div>
    </div>
  )
}

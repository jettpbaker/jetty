import { cn } from '@/lib/utils'
import { useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { TextMorph } from 'torph/react'

import './morph_text.css'

function morphTiming() {
  const style = getComputedStyle(document.documentElement)
  return {
    duration: parseFloat(style.getPropertyValue('--motion-control-duration')),
    ease: style.getPropertyValue('--motion-disclosure-ease').trim(),
  }
}

export function MorphText({ children, className }: { children: string; className?: string }) {
  const [timing] = useState(morphTiming)
  const [text, setText] = useState({ current: children, previous: undefined as string | undefined })
  const reducedMotion = useReducedMotion()
  if (text.current !== children) setText({ current: children, previous: text.current })
  if (reducedMotion)
    return (
      <span key={text.current} className={cn('morph-text-fade', className)}>
        {text.previous !== undefined && (
          <span aria-hidden='true' className='morph-text-before'>
            {text.previous}
          </span>
        )}
        <span className={text.previous !== undefined ? 'morph-text-after' : undefined}>
          {text.current}
        </span>
      </span>
    )
  return (
    <TextMorph
      as='span'
      className={className}
      duration={timing.duration}
      ease={timing.ease}
      scale={false}
    >
      {children}
    </TextMorph>
  )
}

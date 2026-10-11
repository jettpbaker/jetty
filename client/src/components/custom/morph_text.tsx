import { cn } from '@/lib/utils'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { TextMorph } from 'torph/react'

import './morph_text.css'

function morphTiming() {
  const style = getComputedStyle(document.documentElement)
  return {
    duration: parseFloat(style.getPropertyValue('--motion-control-duration')),
    ease: style.getPropertyValue('--motion-disclosure-ease').trim(),
  }
}

export function MorphText({
  children,
  className,
  shimmer = false,
  from,
}: {
  children: string
  className?: string
  shimmer?: boolean
  from?: string
}) {
  const [timing] = useState(morphTiming)
  const [text, setText] = useState({ current: children, previous: from })
  const [morph, setMorph] = useState(from ?? children)
  const reducedMotion = useReducedMotion()
  useEffect(() => setMorph(children), [children])
  if (text.current !== children) setText({ current: children, previous: text.current })
  return (
    <span className={cn('relative inline-block', className)}>
      {reducedMotion ? (
        <span key={text.current} className={cn('morph-text-fade', shimmer && 'opacity-0')}>
          {text.previous !== undefined && (
            <span aria-hidden='true' className='morph-text-before'>
              {text.previous}
            </span>
          )}
          <span className={text.previous !== undefined ? 'morph-text-after' : undefined}>
            {text.current}
          </span>
        </span>
      ) : (
        <TextMorph
          as='span'
          className={shimmer ? 'opacity-0' : undefined}
          duration={timing.duration}
          ease={timing.ease}
          scale={false}
        >
          {morph}
        </TextMorph>
      )}
      {shimmer && (
        // Background-clipped shimmer needs plain text rather than Torph's glyph spans.
        <span aria-hidden='true' className='absolute inset-0 shimmer'>
          {children}
        </span>
      )}
    </span>
  )
}

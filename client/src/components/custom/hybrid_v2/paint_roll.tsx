import { useState } from 'react'

import '../rolling_text.css'

export function PaintRoll({
  text,
  instant,
  quick = false,
  from,
}: {
  text: string
  instant: boolean
  quick?: boolean
  from?: string
}) {
  const [paint, setPaint] = useState({ text, previous: instant ? undefined : from, generation: 0 })
  if (paint.text !== text)
    setPaint({ text, previous: instant ? undefined : paint.text, generation: paint.generation + 1 })
  else if (instant && paint.previous !== undefined) setPaint({ ...paint, previous: undefined })
  return (
    <span
      className={`rolling-text-window inline-block align-bottom${quick ? ' rolling-text-quick font-mono' : ''}`}
      aria-label={text}
    >
      {paint.previous !== undefined && (
        <span aria-hidden='true' className='rolling-text-out'>
          {paint.previous}
        </span>
      )}
      <span
        key={paint.generation}
        className={paint.previous !== undefined ? 'rolling-text-in inline-block' : 'inline-block'}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === 'rolling-text-in')
            setPaint((current) => ({ ...current, previous: undefined }))
        }}
      >
        {text}
      </span>
    </span>
  )
}

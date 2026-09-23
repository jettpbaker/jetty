import { cn } from '@/lib/utils'
import { useState } from 'react'

import './rolling_text.css'

export function RollingText({
  children: target,
  className,
}: {
  children: string
  className?: string
}) {
  const [text, setText] = useState({ current: target, previous: undefined as string | undefined })
  if (text.current !== target) setText({ current: target, previous: text.current })
  return (
    <span className={cn('rolling-text-window', className)} key={text.current}>
      {text.previous !== undefined && (
        <span aria-hidden='true' className='rolling-text-out truncate'>
          {text.previous}
        </span>
      )}
      <span className={cn('block truncate', text.previous !== undefined && 'rolling-text-in')}>
        {text.current}
      </span>
    </span>
  )
}

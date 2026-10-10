import { useChatSettled } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useState } from 'react'

import './rolling_text.css'

export function RollingText({
  children: target,
  className,
  textClassName,
}: {
  children: string
  className?: string
  textClassName?: string
}) {
  const settled = useChatSettled()
  const [text, setText] = useState({ current: target, previous: undefined as string | undefined })
  if (text.current !== target || (settled && text.previous !== undefined))
    setText({ current: target, previous: settled ? undefined : text.current })
  return (
    <span className={cn('rolling-text-window', className)} key={text.current}>
      {text.previous !== undefined && (
        <span aria-hidden='true' className='rolling-text-out truncate'>
          {text.previous}
        </span>
      )}
      <span
        className={cn(
          'block truncate',
          textClassName,
          text.previous !== undefined && 'rolling-text-in'
        )}
      >
        {text.current}
      </span>
    </span>
  )
}

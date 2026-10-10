import { useChatSettled } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useState } from 'react'

import { useDiscrete } from './chat_feel/discrete'
import './rolling_text.css'

export function RollingText({
  children: incoming,
  className,
  textClassName,
  holdMs = 0,
  quick = false,
}: {
  children: string
  className?: string
  textClassName?: string
  holdMs?: number
  quick?: boolean
}) {
  const change = useDiscrete<string, HTMLSpanElement>(
    incoming,
    incoming,
    'rolling label',
    true,
    false,
    holdMs
  )
  const target = change.value
  const changeRef = change.elementRef
  const settled = useChatSettled() || !change.animate
  const [text, setText] = useState({
    current: target,
    previous: undefined as string | undefined,
    generation: 0,
  })
  if (text.current !== target || (settled && text.previous !== undefined))
    setText({
      current: target,
      previous: settled ? undefined : text.current,
      generation: text.generation + (settled ? 0 : 1),
    })
  return (
    <span
      ref={changeRef}
      className={cn('rolling-text-window', quick && 'rolling-text-quick', className)}
      key={text.generation}
    >
      {text.previous !== undefined && (
        <span aria-hidden='true' className='rolling-text-out whitespace-nowrap'>
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

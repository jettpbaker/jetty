import { useChatFeel, useChatSettled, useMorphDuration } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useState, type ReactNode } from 'react'
import { TextMorph } from 'torph/react'

import { capyEase } from './chat_feel/capy'
import './rolling_text.css'

const morphEase = `cubic-bezier(${capyEase.join(', ')})`

export function TenseText({
  children: target,
  active,
  morph,
  mono = false,
  className,
  shimmer = false,
  activeContent,
}: {
  children: string
  active: boolean
  morph: boolean
  mono?: boolean
  className?: string
  shimmer?: boolean
  activeContent?: ReactNode
}) {
  const settled = useChatSettled()
  const feel = useChatFeel()
  const morphDuration = useMorphDuration()
  const timing =
    feel === 'hybrid' && morphDuration !== 'default'
      ? { duration: Number(morphDuration), ease: morphEase }
      : {}
  const [text, setText] = useState({
    current: target,
    active,
    mono,
    generation: 0,
    previous: undefined as { value: string; mono: boolean } | undefined,
  })
  if (text.current !== target || text.active !== active || text.mono !== mono) {
    const liveContent = active && activeContent !== undefined
    const tenseFlip = morph && text.active && !active && !settled
    setText({
      current: target,
      active,
      mono,
      generation: text.generation + (tenseFlip || liveContent ? 0 : 1),
      previous:
        !tenseFlip && !liveContent && !settled && text.current !== target
          ? { value: text.current, mono: text.mono }
          : undefined,
    })
  } else if (settled && text.previous) {
    setText({ ...text, previous: undefined })
  }
  return (
    <span className={cn('rolling-text-window', className)} key={text.generation}>
      {text.previous && (
        <span
          aria-hidden='true'
          className={cn('rolling-text-out truncate', text.previous.mono && 'font-mono')}
        >
          {text.previous.value}
        </span>
      )}
      {active && activeContent}
      <span
        className={cn(
          'block truncate',
          shimmer && active && 'shimmer',
          text.previous && 'rolling-text-in',
          active && activeContent !== undefined && 'hidden'
        )}
      >
        <TextMorph disabled={settled || !morph || active} {...timing} respectReducedMotion>
          {mono ? '' : target}
        </TextMorph>
        <TextMorph
          className='font-mono'
          disabled={settled || !morph || active}
          {...timing}
          respectReducedMotion
        >
          {mono ? target : ''}
        </TextMorph>
      </span>
    </span>
  )
}

import { useChatSettled, useFadeDuration, useTenseChange } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useReducedMotion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'

import { capyEase } from './chat_feel/capy'
import { useDiscrete } from './chat_feel/discrete'
import './rolling_text.css'

const fadeEase = `cubic-bezier(${capyEase.join(', ')})`

export function TenseText({
  children: incoming,
  active: incomingActive,
  mono: incomingMono = false,
  className,
  shimmer = false,
  activeContent,
}: {
  children: string
  active: boolean
  mono?: boolean
  className?: string
  shimmer?: boolean
  activeContent?: ReactNode
}) {
  const requested = useMemo(
    () => ({ target: incoming, active: incomingActive, mono: incomingMono }),
    [incoming, incomingActive, incomingMono]
  )
  const change = useDiscrete<typeof requested, HTMLSpanElement>(
    requested,
    requested,
    'tense label',
    true,
    incomingActive && activeContent !== undefined
  )
  const { target, active, mono } = change.value
  const changeRef = change.elementRef
  const settled = useChatSettled() || !change.animate
  const reducedMotion = useReducedMotion()
  const fade = Number(useFadeDuration())
  const crossfadeFlips = useTenseChange() === 'crossfade'
  const [text, setText] = useState({
    current: target,
    active,
    mono,
    generation: 0,
    previous: undefined as { value: string; mono: boolean; crossfade: boolean } | undefined,
  })
  if (text.current !== target || text.active !== active || text.mono !== mono) {
    const liveContent = active && activeContent !== undefined
    setText({
      current: target,
      active,
      mono,
      generation: text.generation + (text.current !== target && !liveContent && !settled ? 1 : 0),
      previous:
        // Text appearing from nothing is an entrance, not another of the same thing: no roll.
        !liveContent && !settled && !reducedMotion && text.current !== '' && text.current !== target
          ? {
              value: text.current,
              mono: text.mono,
              crossfade: crossfadeFlips && text.active && !active,
            }
          : undefined,
    })
  } else if ((settled || reducedMotion) && text.previous) {
    setText({ ...text, previous: undefined })
  }

  return (
    <span ref={changeRef} className={cn('rolling-text-window', className)}>
      {text.previous && (
        <span
          key='out'
          aria-hidden='true'
          className={cn(
            'absolute inset-0 pointer-events-none whitespace-nowrap',
            !text.previous.crossfade && 'rolling-text-out',
            text.previous.mono && 'font-mono'
          )}
          style={
            text.previous.crossfade
              ? {
                  animation: `rolling-text-fade-out ${fade * 0.8}ms ${fadeEase} both`,
                }
              : undefined
          }
        >
          {text.previous.value}
        </span>
      )}
      <span
        key={text.generation}
        className={cn(
          'block truncate',
          text.mono && 'font-mono',
          shimmer && active && 'shimmer',
          text.previous && !text.previous.crossfade && 'rolling-text-in'
        )}
        style={
          text.previous?.crossfade
            ? { animation: `rolling-text-fade-in ${fade}ms ${fadeEase} both` }
            : undefined
        }
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return
          if (
            event.animationName !==
            (text.previous?.crossfade ? 'rolling-text-fade-in' : 'rolling-text-in')
          )
            return
          setText((current) => (current.previous ? { ...current, previous: undefined } : current))
        }}
      >
        {active && activeContent !== undefined ? activeContent : text.current}
      </span>
    </span>
  )
}

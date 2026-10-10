import { hybridLabelHoldMs, useChatSettled, useFadeDuration, useTenseChange } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useReducedMotion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'

import { capyEase } from './chat_feel/capy'
import { useDiscrete } from './chat_feel/discrete'
import { OpencodeText } from './opencode_text'
import { RollingText } from './rolling_text'
import './rolling_text.css'

const fadeEase = `cubic-bezier(${capyEase.join(', ')})`

export function TenseText({
  children: incoming,
  active: incomingActive,
  mono: incomingMono = false,
  className,
  shimmer = false,
  activeContent,
  holdMs = 0,
  count,
}: {
  children: string
  active: boolean
  mono?: boolean
  className?: string
  shimmer?: boolean
  activeContent?: ReactNode
  holdMs?: number
  count?: number
}) {
  const [lastCount, setLastCount] = useState(count)
  if (count !== undefined && count !== lastCount) setLastCount(count)
  const displayCount = count ?? lastCount
  const counted = count !== undefined
  const targetText = count === undefined ? incoming : incoming.replace(String(count), '{count}')
  const requested = useMemo(
    () => ({ target: targetText, active: incomingActive, mono: incomingMono, counted }),
    [targetText, incomingActive, incomingMono, counted]
  )
  const opencode = useTenseChange() === 'opencode'
  const change = useDiscrete<typeof requested, HTMLSpanElement>(
    requested,
    requested,
    'tense label',
    !opencode,
    incomingActive && activeContent !== undefined,
    holdMs
  )
  const { target, active, mono, counted: shownCounted } = change.value
  const changeRef = change.elementRef
  const settled = useChatSettled() || !change.animate
  const reducedMotion = useReducedMotion()
  const fade = Number(useFadeDuration())
  const crossfadeFlips = useTenseChange() === 'crossfade'
  const [text, setText] = useState({
    current: target,
    active,
    mono,
    counted: shownCounted,
    generation: 0,
    previous: undefined as
      | { value: string; mono: boolean; counted: boolean; crossfade: boolean }
      | undefined,
  })
  if (
    text.current !== target ||
    text.active !== active ||
    text.mono !== mono ||
    text.counted !== shownCounted
  ) {
    const liveContent = active && activeContent !== undefined
    setText({
      current: target,
      active,
      mono,
      counted: shownCounted,
      generation: text.generation + (text.current !== target && !liveContent && !settled ? 1 : 0),
      previous:
        // Text appearing from nothing is an entrance, not another of the same thing: no roll.
        !liveContent && !settled && !reducedMotion && text.current !== '' && text.current !== target
          ? {
              value: text.current,
              mono: text.mono,
              counted: text.counted,
              crossfade: crossfadeFlips && text.active && !active,
            }
          : undefined,
    })
  } else if ((settled || reducedMotion) && text.previous) {
    setText({ ...text, previous: undefined })
  }

  if (opencode)
    return (
      <span ref={changeRef} className={className}>
        <OpencodeText
          active={active}
          mono={mono}
          shimmer={shimmer}
          instant={settled || !!reducedMotion}
          onFinish={change.finish}
          activeContent={activeContent}
          count={text.counted ? displayCount : undefined}
        >
          {text.current}
        </OpencodeText>
      </span>
    )

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
          {text.previous.counted
            ? text.previous.value.replace('{count}', String(displayCount))
            : text.previous.value}
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
        {active && activeContent !== undefined ? (
          activeContent
        ) : text.counted ? (
          <span className='inline-flex items-baseline'>
            <span className='whitespace-pre'>{text.current.split('{count}')[0]}</span>
            <RollingText
              quick
              holdMs={holdMs || (counted ? hybridLabelHoldMs : 0)}
              className='font-mono'
            >
              {String(displayCount)}
            </RollingText>
            <span className='whitespace-pre'>{text.current.split('{count}')[1]}</span>
          </span>
        ) : (
          text.current
        )}
      </span>
    </span>
  )
}

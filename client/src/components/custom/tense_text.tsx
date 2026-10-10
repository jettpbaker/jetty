import { useChatFeel, useChatSettled, useMorphDuration, useTenseChange } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { TextMorph } from 'torph/react'

import { capyEase } from './chat_feel/capy'
import './rolling_text.css'

const morphEase = `cubic-bezier(${capyEase.join(', ')})`

export function TenseText({
  children: target,
  active,
  verb = false,
  mono = false,
  className,
  shimmer = false,
  activeContent,
}: {
  children: string
  active: boolean
  verb?: boolean
  mono?: boolean
  className?: string
  shimmer?: boolean
  activeContent?: ReactNode
}) {
  const settled = useChatSettled()
  const reducedMotion = useReducedMotion()
  const feel = useChatFeel()
  const morphDuration = useMorphDuration()
  const mode = useTenseChange()
  const morph = mode === 'torph' || (mode === 'smart' && verb)
  const timing =
    feel === 'hybrid' && morphDuration !== 'default'
      ? { duration: Number(morphDuration), ease: morphEase }
      : {}
  const [text, setText] = useState({
    current: target,
    active,
    mono,
    generation: 0,
    morphFrom: undefined as string | undefined,
    previous: undefined as { value: string; mono: boolean; crossfade: boolean } | undefined,
  })
  if (text.current !== target || text.active !== active || text.mono !== mono) {
    const liveContent = active && activeContent !== undefined
    const tenseFlip = text.active && !active && !settled && !reducedMotion
    const crossfade = tenseFlip && (mode === 'crossfade' || (mode === 'smart' && !verb))
    const morphFlip = tenseFlip && morph
    setText({
      current: target,
      active,
      mono,
      generation: text.generation + (morphFlip || liveContent ? 0 : 1),
      morphFrom: morphFlip && text.current !== target ? text.current : undefined,
      previous:
        !morphFlip && !liveContent && !settled && !reducedMotion && text.current !== target
          ? { value: text.current, mono: text.mono, crossfade }
          : undefined,
    })
  } else if ((settled || reducedMotion) && (text.previous || text.morphFrom !== undefined)) {
    setText({ ...text, previous: undefined, morphFrom: undefined })
  }

  function finishMorph() {
    setText((current) => ({ ...current, morphFrom: undefined }))
  }
  return (
    <span className={cn('rolling-text-window', className)} key={text.generation}>
      {text.previous && (
        <span
          aria-hidden='true'
          className={cn(
            'absolute inset-0 pointer-events-none truncate',
            !text.previous.crossfade && 'rolling-text-out',
            text.previous.mono && 'font-mono'
          )}
          style={
            text.previous.crossfade
              ? { animation: `rolling-text-fade-out 120ms ${morphEase} both` }
              : undefined
          }
        >
          {text.previous.value}
        </span>
      )}
      {active && activeContent}
      <span
        className={cn(
          'block truncate',
          mono && 'font-mono',
          shimmer && active && 'shimmer',
          text.previous && !text.previous.crossfade && 'rolling-text-in',
          active && activeContent !== undefined && 'hidden'
        )}
        style={
          text.previous?.crossfade
            ? { animation: `rolling-text-fade-in 150ms ${morphEase} both` }
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
        {text.morphFrom !== undefined && !settled && morph && !reducedMotion ? (
          <MorphingText from={text.morphFrom} target={target} onFinish={finishMorph} {...timing} />
        ) : (
          target
        )}
      </span>
    </span>
  )
}

function MorphingText({
  from,
  target,
  onFinish,
  ...timing
}: {
  from: string
  target: string
  onFinish: () => void
  duration?: number
  ease?: string
}) {
  const [value, setValue] = useState(from)
  useEffect(() => setValue(target), [target])
  return (
    <TextMorph
      {...timing}
      onAnimationComplete={onFinish}
      onAnimationCancel={onFinish}
      respectReducedMotion
    >
      {value}
    </TextMorph>
  )
}

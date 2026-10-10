import { useChatFeel, useChatSettled, useMorphDuration, useTenseChange } from '@/lib/chat-feel'
import { cn } from '@/lib/utils'
import { useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MorphController } from 'torph'

import { capyEase } from './chat_feel/capy'
import './rolling_text.css'

const morphEase = `cubic-bezier(${capyEase.join(', ')})`
// Torph's own default; crossfades borrow whichever timing the morph uses.
const torphTiming = { duration: 400, ease: 'cubic-bezier(0.19, 1, 0.22, 1)' }

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
      : torphTiming
  const [text, setText] = useState({
    current: target,
    active,
    mono,
    generation: 0,
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
      generation: text.generation + (text.current !== target && !morphFlip && !liveContent ? 1 : 0),
      previous:
        !morphFlip && !liveContent && !settled && !reducedMotion && text.current !== target
          ? { value: text.current, mono: text.mono, crossfade }
          : undefined,
    })
  } else if ((settled || reducedMotion) && text.previous) {
    setText({ ...text, previous: undefined })
  }

  return (
    <span className={cn('rolling-text-window', className)}>
      {text.previous && (
        <span
          key='out'
          aria-hidden='true'
          className={cn(
            'absolute inset-0 pointer-events-none truncate',
            !text.previous.crossfade && 'rolling-text-out',
            text.previous.mono && 'font-mono'
          )}
          style={
            text.previous.crossfade
              ? {
                  animation: `rolling-text-fade-out ${timing.duration * 0.8}ms ${timing.ease} both`,
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
          mono && 'font-mono',
          shimmer && active && 'shimmer',
          text.previous && !text.previous.crossfade && 'rolling-text-in'
        )}
        style={
          text.previous?.crossfade
            ? { animation: `rolling-text-fade-in ${timing.duration}ms ${timing.ease} both` }
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
        ) : morph ? (
          <MorphingText
            value={target}
            disabled={active || settled || !!reducedMotion}
            {...timing}
          />
        ) : (
          target
        )}
      </span>
    </span>
  )
}

// Torph owns this node for its lifetime. Attach and update before paint; its React adapter's
// effects leave an uninitialised frame, and replacing its children with React text corrupts it.
function MorphingText({
  value,
  disabled,
  duration,
  ease,
}: {
  value: string
  disabled: boolean
  duration: number
  ease: string
}) {
  const elementRef = useRef<HTMLSpanElement>(null)
  const [controller] = useState(() => new MorphController())
  useLayoutEffect(() => {
    controller.attach(elementRef.current!, { duration, ease, disabled })
    return () => controller.destroy()
  }, [controller, duration, ease, disabled])
  useLayoutEffect(() => {
    controller.update(value)
  }, [controller, value, duration, ease, disabled])
  return <span ref={elementRef} className='inline-block align-top' />
}

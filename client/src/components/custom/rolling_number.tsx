import { getMotionTokens } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useRef } from 'react'
import { TextMorph } from 'torph/react'

function reverseRoll(animation: Animation) {
  const effect = animation.effect
  if (!(effect instanceof KeyframeEffect)) return
  effect.setKeyframes(
    effect.getKeyframes().map((frame) => {
      if (typeof frame.transform !== 'string') return frame
      const transform = new DOMMatrix(frame.transform)
      transform.m42 *= -1
      return { ...frame, transform: transform.toString() }
    })
  )
}

export function RollingNumber({
  value,
  className,
  bidirectional = false,
}: {
  value: number | string
  className?: string
  bidirectional?: boolean
}) {
  const digitsRef = useRef<HTMLSpanElement>(null)
  const previousValue = useRef(value)
  const { rolling } = getMotionTokens()
  function animateDigits() {
    const reverse = bidirectional && Number(value) < Number(previousValue.current)
    previousValue.current = value
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const existing = reverse
      ? new Set(digitsRef.current?.getAnimations({ subtree: true }))
      : undefined
    queueMicrotask(() => {
      const digits = digitsRef.current?.querySelectorAll<HTMLElement>('[torph-kind="digit"] > span')
      if (!digits) return
      for (const digit of digits) {
        const moving = digit
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect instanceof KeyframeEffect &&
              animation.effect.getKeyframes().some((frame) => frame.transform !== undefined)
          )
        if (!moving.length) continue
        if (reverse)
          for (const animation of moving) if (!existing?.has(animation)) reverseRoll(animation)
        digit.animate(
          [
            { filter: 'blur(0)', offset: 0 },
            { filter: 'blur(1px)', offset: 0.15 },
            { filter: 'blur(0)', offset: 1 },
          ],
          { duration: rolling.durationMs, easing: rolling.ease }
        )
      }
    })
  }
  return (
    <span ref={digitsRef} className={cn('inline-block tabular-nums', className)}>
      <TextMorph
        onAnimationStart={animateDigits}
        as='span'
        duration={rolling.durationMs}
        ease={rolling.ease}
        scale={false}
        numbers
      >
        {value}
      </TextMorph>
    </span>
  )
}

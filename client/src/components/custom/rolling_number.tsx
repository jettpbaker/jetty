import { getMotionTokens } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useRef } from 'react'
import { TextMorph } from 'torph/react'

export function RollingNumber({
  value,
  className,
}: {
  value: number | string
  className?: string
}) {
  const digitsRef = useRef<HTMLSpanElement>(null)
  const { rolling } = getMotionTokens()
  function blurDigits() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    queueMicrotask(() => {
      const digits = digitsRef.current?.querySelectorAll<HTMLElement>('[torph-kind="digit"] > span')
      if (!digits) return
      for (const digit of digits) {
        const moving = digit
          .getAnimations()
          .some(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect instanceof KeyframeEffect &&
              animation.effect.getKeyframes().some((frame) => frame.transform !== undefined)
          )
        if (!moving) continue
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
        onAnimationStart={blurDigits}
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

import { getMotionTokens } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useLayoutEffect, useRef, useState } from 'react'

const glyph = 'before:content-[attr(data-digit)]'

// Higher digits sit above, so counting up rolls down. Ten lines each way covers any interrupted roll.
const stripOffsets = Array.from({ length: 21 }, (_, index) => 10 - index)

function RollingDigit({ digit }: { digit: number }) {
  const [previous, setPrevious] = useState(digit)
  const [rolling, setRolling] = useState(false)
  if (digit !== previous) {
    setPrevious(digit)
    setRolling(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }
  const stripRef = useRef<HTMLSpanElement>(null)
  const settlesOn = useRef(digit)
  const lines = useRef(0)
  const roll = useRef<Animation>(null)
  useLayoutEffect(() => {
    const strip = stripRef.current
    const forward = (digit - settlesOn.current + 10) % 10
    settlesOn.current = digit
    if (!strip || !forward) return
    const progress = roll.current?.effect?.getComputedTiming().progress ?? 1
    const shortest = forward > 5 ? forward - 10 : forward
    lines.current = (shortest + lines.current * (1 - progress)) % 10
    const { durationMs, ease } = getMotionTokens().rolling
    roll.current?.cancel()
    roll.current = strip.animate(
      [{ transform: `translateY(calc(${-lines.current} * 1lh))` }, { transform: 'translateY(0)' }],
      { duration: durationMs, easing: ease }
    )
    roll.current.onfinish = () => setRolling(false)
  }, [digit])
  return (
    <span className='relative inline-block'>
      <span data-digit={digit} className={cn(glyph, rolling && 'invisible')} />
      {rolling && (
        <span className='absolute inset-0 overflow-clip [mask-image:linear-gradient(to_bottom,transparent,black_22%,black_78%,transparent)]'>
          <span ref={stripRef} className='absolute inset-x-0 top-[-10lh]'>
            {stripOffsets.map((offset) => (
              <span
                key={offset}
                data-digit={(digit + offset + 10) % 10}
                className={cn('block', glyph)}
              />
            ))}
          </span>
        </span>
      )}
    </span>
  )
}

export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const digits = [...String(value)]
  const [firstLength] = useState(digits.length)
  return (
    <span className={cn('inline-block tabular-nums', className)}>
      <span className='sr-only'>{value}</span>
      <span aria-hidden>
        {digits.map((digit, index) => {
          const place = digits.length - 1 - index
          return (
            <span
              key={place}
              className={cn(
                'inline-block',
                place >= firstLength &&
                  'transition-opacity duration-(--motion-rolling-fade-in-duration) ease-(--motion-rolling-ease) starting:opacity-0'
              )}
            >
              <RollingDigit digit={Number(digit)} />
            </span>
          )
        })}
      </span>
    </span>
  )
}

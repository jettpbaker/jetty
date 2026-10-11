import { RollingNumber } from '@/components/custom/rolling_number'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { TextMorph } from 'torph/react'

import './work_completion.css'

type CompletionVariant = 'morph' | 'fast' | 'blur' | 'sharp'

const variants = [
  { variant: 'morph', title: '1. Current morph', description: '250ms · original disclosure curve' },
  { variant: 'fast', title: '2. Faster', description: '150ms · same curve, shorter duration' },
  { variant: 'blur', title: '3. Soft blur', description: '250ms · original with a 1px blur' },
  { variant: 'sharp', title: '4. Sharper curve', description: '250ms · stronger ease-out' },
] as const

function completionTiming(variant: CompletionVariant) {
  const style = getComputedStyle(document.documentElement)
  return {
    duration: parseFloat(
      style.getPropertyValue(
        variant === 'fast' ? '--motion-control-duration' : '--motion-disclosure-open-duration'
      )
    ),
    ease: style
      .getPropertyValue(variant === 'sharp' ? '--motion-popup-ease' : '--motion-disclosure-ease')
      .trim(),
  }
}

function FileLabel({ complete }: { complete: boolean }) {
  return (
    <span className='inline-flex items-baseline gap-1'>
      <span className={complete ? undefined : 'shimmer'}>{complete ? 'Read' : 'Reading'}</span>
      <RollingNumber value={3} className='font-mono' />
      <span>files</span>
    </span>
  )
}

function CompletionLabel({ variant }: { variant: CompletionVariant }) {
  const [complete, setComplete] = useState(false)
  const [timing] = useState(() => completionTiming(variant))
  const morphRef = useRef<HTMLSpanElement>(null)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    const timer = setTimeout(() => setComplete(true), 1000)
    return () => clearTimeout(timer)
  }, [])
  const label = complete ? 'Read 3 files' : 'Reading 3 files'
  function blurMorph() {
    if (variant !== 'blur' || !complete || reducedMotion) return
    morphRef.current?.animate(
      [
        { filter: 'blur(0)', offset: 0 },
        { filter: 'blur(1px)', offset: 0.2 },
        { filter: 'blur(0)', offset: 1 },
      ],
      { duration: timing.duration, easing: timing.ease }
    )
  }
  return (
    <div className='activity-header text-muted-foreground' data-flush aria-label={label}>
      {!reducedMotion ? (
        <span ref={morphRef}>
          <TextMorph
            as='span'
            className='completion-morph'
            duration={timing.duration}
            ease={timing.ease}
            scale={false}
            onAnimationStart={blurMorph}
          >
            {label}
          </TextMorph>
        </span>
      ) : (
        <span className='completion-swap' data-complete={complete} aria-hidden='true'>
          <span className='completion-before'>
            <FileLabel complete={false} />
          </span>
          <span className='completion-after'>
            <FileLabel complete />
          </span>
        </span>
      )}
    </div>
  )
}

function CompletionExample({
  variant,
  title,
  description,
}: {
  variant: CompletionVariant
  title: string
  description: string
}) {
  const [run, setRun] = useState(0)
  return (
    <section aria-label={title} data-completion-example={variant}>
      <div className='mb-6 flex items-center justify-between gap-4'>
        <div>
          <h3 className='text-sm font-medium'>{title}</h3>
          <p className='mt-1 text-xs text-muted-foreground'>{description}</p>
        </div>
        <Button size='sm' aria-label={`Replay ${title}`} {...pressProps(() => setRun(run + 1))}>
          Replay
        </Button>
      </div>
      <CompletionLabel key={run} variant={variant} />
    </section>
  )
}

export function CompletionPreviews() {
  return (
    <section aria-labelledby='completion-label'>
      <h2 id='completion-label' className='mb-8 text-sm font-medium'>
        Character morph variations
      </h2>
      <div className='grid gap-12 md:grid-cols-2 md:gap-16'>
        {variants.map((option) => (
          <CompletionExample key={option.variant} {...option} />
        ))}
      </div>
    </section>
  )
}

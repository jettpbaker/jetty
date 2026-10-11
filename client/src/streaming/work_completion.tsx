import { RollingNumber } from '@/components/custom/rolling_number'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { TextMorph } from 'torph/react'

import './work_completion.css'

type CompletionVariant = 'instant' | 'crossfade' | 'fade-through' | 'lift' | 'morph'

const variants = [
  { variant: 'crossfade', title: '1. Crossfade', description: '150ms · soften the whole label' },
  { variant: 'fade-through', title: '2. Fade through', description: '250ms · fade out, then in' },
  { variant: 'lift', title: '3. Lift', description: '250ms · swap upward by 8px' },
  { variant: 'morph', title: '4. Character morph', description: '250ms · keep shared letters' },
] as const

function completionTiming() {
  const style = getComputedStyle(document.documentElement)
  return {
    duration: parseFloat(style.getPropertyValue('--motion-disclosure-open-duration')),
    ease: style.getPropertyValue('--motion-disclosure-ease').trim(),
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
  const [timing] = useState(completionTiming)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    const timer = setTimeout(() => setComplete(true), 1000)
    return () => clearTimeout(timer)
  }, [])
  const label = complete ? 'Read 3 files' : 'Reading 3 files'
  return (
    <div className='activity-header text-muted-foreground' data-flush aria-label={label}>
      {variant === 'instant' ? (
        <FileLabel complete={complete} />
      ) : variant === 'morph' && !reducedMotion ? (
        <TextMorph
          as='span'
          className='completion-morph'
          duration={timing.duration}
          ease={timing.ease}
          scale={false}
        >
          {label}
        </TextMorph>
      ) : (
        <span
          className='completion-swap'
          data-variant={variant}
          data-complete={complete}
          aria-hidden='true'
        >
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
        Completion transitions
      </h2>
      <div className='grid gap-12 md:grid-cols-2 md:gap-16'>
        <CompletionExample
          variant='instant'
          title='Current · instant'
          description='No transition'
        />
        <div className='hidden md:block' aria-hidden='true' />
        {variants.map((option) => (
          <CompletionExample key={option.variant} {...option} />
        ))}
      </div>
    </section>
  )
}

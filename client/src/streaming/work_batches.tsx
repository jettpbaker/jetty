import type { ToolBatch } from '@/components/custom/work_model'

import { ToolGroup } from '@/components/custom/tool_group'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import './work_batches.css'

type BatchVariant = 'current' | 'fade' | 'hold' | 'settle'

const variants = [
  {
    variant: 'current',
    title: '1. Instant rows',
    description: 'Instant rows · close and next together',
  },
  { variant: 'fade', title: '2. Fade', description: '150ms fade · close and next together' },
  {
    variant: 'hold',
    title: '3. Lift + brief hold',
    description: '150ms lift · next arrives, then closing starts 150ms later',
  },
  {
    variant: 'settle',
    title: '4. Close, then next',
    description: '250ms lift · close for 200ms before the next action appears',
  },
] as const

function BatchSequence({ variant }: { variant: BatchVariant }) {
  const [step, setStep] = useState(0)
  const [nextVisible, setNextVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    const timers = [700, 1400, 2100, 2600, 3600].map((at, index) =>
      setTimeout(() => setStep(index + 1), at)
    )
    if (variant !== 'settle' || reducedMotion)
      timers.push(setTimeout(() => setNextVisible(true), 2600))
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [variant, reducedMotion])
  useEffect(() => {
    if (variant !== 'settle' || step !== 4) return
    const container = containerRef.current!
    const panel = container.querySelector(
      ':scope > [data-slot="collapsible"] > [data-slot="collapsible-content"]'
    )
    if (reducedMotion || !panel) {
      setNextVisible(true)
      return
    }
    const observer = new MutationObserver(() => {
      if (!panel.isConnected) {
        setNextVisible(true)
        observer.disconnect()
      }
    })
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [step, variant, reducedMotion])
  const files: ToolBatch = {
    type: 'tools',
    id: 'batch-preview',
    sealed: step >= 4,
    calls: ['package.json', 'src/index.ts', 'src/config.ts']
      .slice(0, Math.min(step + 1, 3))
      .map((target, index) => ({
        type: 'tool',
        id: `batch-preview:${index}`,
        kind: 'read',
        name: 'Read',
        target,
        status: step > index ? 'complete' : 'running',
        input: JSON.stringify({ file_path: target }),
        output: 'File contents',
      })),
  }
  const next: ToolBatch = {
    type: 'tools',
    id: 'batch-next',
    sealed: step >= 5,
    calls: [
      {
        type: 'tool',
        id: 'batch-next:search',
        kind: 'web',
        name: 'WebSearch',
        target: 'React streaming UI',
        status: step >= 5 ? 'complete' : 'running',
      },
    ],
  }
  return (
    <div className='min-h-44'>
      <div className='activity-header text-muted-foreground' data-flush>
        <span>Working</span>
      </div>
      <div
        ref={containerRef}
        className='batch-motion work-scroll'
        data-batch-motion={variant}
        data-arrival={variant === 'current' ? undefined : variant === 'fade' ? 'fade' : 'lift'}
      >
        <ToolGroup batch={files} />
        {nextVisible && (
          <div className={cn('batch-next', variant === 'current' && 'work-raise-enter')}>
            <ToolGroup batch={next} />
          </div>
        )}
      </div>
    </div>
  )
}

function BatchExample({
  variant,
  title,
  description,
}: {
  variant: BatchVariant
  title: string
  description: string
}) {
  const [run, setRun] = useState(0)
  return (
    <section aria-label={title} data-batch-example={variant}>
      <div className='mb-6 flex items-start justify-between gap-4'>
        <div>
          <h3 className='text-sm font-medium'>{title}</h3>
          <p className='mt-1 text-xs text-muted-foreground'>{description}</p>
        </div>
        <Button
          size='sm'
          aria-label={`Replay batch ${title}`}
          {...pressProps(() => setRun(run + 1))}
        >
          Replay
        </Button>
      </div>
      <BatchSequence key={run} variant={variant} />
    </section>
  )
}

export function BatchMotionPreviews() {
  const [run, setRun] = useState(0)
  return (
    <section aria-labelledby='batch-motion-label'>
      <div className='mb-8 flex items-center justify-between gap-4'>
        <h2 id='batch-motion-label' className='text-sm font-medium'>
          File arrivals & batch handoff
        </h2>
        <Button
          size='sm'
          aria-label='Replay all batch variations'
          {...pressProps(() => setRun(run + 1))}
        >
          Replay all
        </Button>
      </div>
      <div key={run} className='grid gap-12 md:grid-cols-2 md:gap-16'>
        {variants.map((option) => (
          <BatchExample key={option.variant} {...option} />
        ))}
      </div>
    </section>
  )
}

import type { ContextUsage } from '@jetty/shared/events'

import { cn } from '@/lib/utils'

const radius = 90
const circumference = 2 * Math.PI * radius

// How full a thread's context window is; red from 90%.
export function ContextRing({
  context,
  className,
}: {
  context: ContextUsage | null
  className?: string
}) {
  const fraction = context ? Math.max(0, Math.min(1, context.usedTokens / context.maxTokens)) : 0
  return (
    <svg
      viewBox='0 0 256 256'
      aria-hidden='true'
      className={cn(fraction >= 0.9 && 'text-destructive', className)}
    >
      <circle cx='128' cy='128' r={radius} fill='none' strokeWidth='26' className='stroke-border' />
      {context && (
        <circle
          cx='128'
          cy='128'
          r={radius}
          fill='none'
          strokeWidth='26'
          stroke='currentColor'
          strokeLinecap='round'
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform='rotate(-90 128 128)'
        />
      )}
    </svg>
  )
}

import type { ContextUsage } from '@jetty/shared/events'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useThreadContext } from '@/state'

const radius = 90
const circumference = 2 * Math.PI * radius

function fullness(context: ContextUsage | null) {
  return context ? Math.max(0, Math.min(1, context.usedTokens / context.maxTokens)) : 0
}

// How full a thread's context window is; red from 90%.
export function ContextRing({
  context,
  className,
}: {
  context: ContextUsage | null
  className?: string
}) {
  const fraction = fullness(context)
  return (
    <svg
      viewBox='0 0 256 256'
      aria-hidden='true'
      className={cn(fraction >= 0.9 ? 'text-destructive' : 'text-foreground', className)}
    >
      <circle
        cx='128'
        cy='128'
        r={radius}
        fill='none'
        strokeWidth='26'
        className='stroke-muted-foreground/40'
      />
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

export function ThreadContextRing({ threadId }: { threadId: string }) {
  const context = useThreadContext(threadId)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            tone='muted'
            size='icon'
            aria-label={
              context
                ? `Context window ${Math.round(fullness(context) * 100)}% full`
                : 'Context usage unavailable'
            }
          />
        }
      >
        <ContextRing context={context} />
      </TooltipTrigger>
      <TooltipContent side='left'>
        {context
          ? `${context.usedTokens.toLocaleString()} / ${context.maxTokens.toLocaleString()} context tokens`
          : 'No context reading yet'}
      </TooltipContent>
    </Tooltip>
  )
}

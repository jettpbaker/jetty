import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { CaretDownIcon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'

import { Shimmer } from '@/components/ai-elements/shimmer'

// Durable chain-of-thought block. Default closed when finished; open while
// streaming. Body is muted so it sits under the main response.

export type ReasoningStatus = 'streaming' | 'done'

export function Reasoning({
  status = 'done',
  durationSec,
  topic,
  defaultOpen,
  children,
  className,
}: {
  status?: ReasoningStatus
  durationSec?: number
  topic?: string
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  const streaming = status === 'streaming'
  const [open, setOpen] = useState(defaultOpen ?? streaming)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('w-full', className)}>
      <CollapsibleTrigger className='group flex w-full items-center gap-1.5 py-0.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground'>
        {streaming ? (
          <Shimmer as='span' className='font-medium' duration={1.4}>
            {topic ? `Thinking — ${topic}` : 'Thinking'}
          </Shimmer>
        ) : (
          <span className='font-medium'>
            {durationSec !== undefined
              ? `Thought for ${durationSec}s`
              : topic
                ? `Thought — ${topic}`
                : 'Thought'}
          </span>
        )}
        <CaretDownIcon
          className={cn(
            'size-3.5 shrink-0 opacity-60 transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className='overflow-hidden text-sm text-muted-foreground/90 data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:animate-in data-starting-style:fade-in-0'>
        <div className='mt-2 border-l border-border/70 pl-3 leading-relaxed'>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

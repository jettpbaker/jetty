import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { CaretDownIcon, StackIcon } from '@phosphor-icons/react'
import { type ReactNode, useState } from 'react'

import { Shimmer } from '@/components/ai-elements/shimmer'

// Consecutive read/search/list tools fold into one row so the timeline
// doesn't explode. Nested rows stay compact (title + path only).

export type ContextCount = {
  label: string // e.g. "reads", "searches"
  count: number
}

function formatCounts(counts: ContextCount[]): string {
  return counts
    .filter((c) => c.count > 0)
    .map((c) => `${c.count} ${c.count === 1 ? c.label.replace(/s$/, '') : c.label}`)
    .join(', ')
}

export function ContextGroup({
  status = 'completed',
  counts,
  defaultOpen = false,
  children,
  className,
}: {
  status?: 'running' | 'completed'
  counts: ContextCount[]
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const summary = formatCounts(counts)
  const running = status === 'running'

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('w-full', className)}>
      <CollapsibleTrigger className='group flex w-full items-center gap-2 py-1 text-left text-sm outline-none'>
        <StackIcon className='size-3.5 shrink-0 text-muted-foreground' />
        <div className='flex min-w-0 flex-1 items-baseline gap-2'>
          {running ? (
            <Shimmer as='span' className='font-medium' duration={1.4}>
              Gathering context
            </Shimmer>
          ) : (
            <span className='font-medium text-foreground'>Gathered context</span>
          )}
          {summary ? (
            <span className='truncate text-xs text-muted-foreground'>{summary}</span>
          ) : null}
        </div>
        <CaretDownIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className='overflow-hidden data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:animate-in data-starting-style:fade-in-0'>
        <div className='ml-[22px] flex flex-col border-l border-border/60 pl-3'>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

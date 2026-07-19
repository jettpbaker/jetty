import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { CaretDownIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useState } from 'react'

// Errors get their own surface — not a success tool row with a red badge.

export function ToolError({
  tool,
  summary,
  detail,
  defaultOpen = false,
  className,
}: {
  tool: string
  summary: string
  detail?: string
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const expandable = !!detail

  const row = (
    <div className='flex w-full min-w-0 items-center gap-2 py-1 text-left text-sm'>
      <WarningCircleIcon className='size-3.5 shrink-0 text-destructive' weight='fill' />
      <div className='flex min-w-0 flex-1 items-baseline gap-2'>
        <span className='shrink-0 font-medium text-destructive'>{tool} failed</span>
        <span className='truncate text-muted-foreground'>{summary}</span>
      </div>
      {expandable ? (
        <CaretDownIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      ) : null}
    </div>
  )

  if (!expandable) {
    return <div className={cn('w-full', className)}>{row}</div>
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('w-full', className)}>
      <CollapsibleTrigger className='w-full outline-none'>{row}</CollapsibleTrigger>
      <CollapsibleContent className='overflow-hidden data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:animate-in data-starting-style:fade-in-0'>
        <pre className='mt-1 mb-2 ml-[22px] overflow-x-auto rounded-md border border-destructive/20 bg-destructive/5 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-destructive'>
          {detail}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

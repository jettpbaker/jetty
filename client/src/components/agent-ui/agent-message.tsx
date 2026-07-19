import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

// Asymmetric user / assistant layout. Meta (model · duration) sits under
// the last assistant text block, quiet until the turn is idle.

export function UserMessage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex justify-end', className)}>
      <Bubble variant='secondary' align='end' className='max-w-[min(82%,42rem)]'>
        <BubbleContent className='whitespace-pre-wrap'>{children}</BubbleContent>
      </Bubble>
    </div>
  )
}

export function AssistantMessage({
  children,
  meta,
  className,
}: {
  children: ReactNode
  meta?: string
  className?: string
}) {
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <div className='text-sm leading-relaxed text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'>
        {children}
      </div>
      {meta ? (
        <div className='font-mono text-[11px] text-muted-foreground/70'>{meta}</div>
      ) : null}
    </div>
  )
}

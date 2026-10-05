import type { ComponentProps, ComponentType, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from 'cn'

// A divider across the transcript that carries a short state between messages: queued, paused,
// compacted, a report arriving. Hairlines either side; the content stays one line.
export function ChatSeam({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-6 min-w-0 items-center gap-3 text-sm text-muted-foreground',
        className
      )}
    >
      <span aria-hidden='true' className='min-w-6 flex-1 border-t border-border' />
      <span className='flex min-w-0 items-center gap-1.5'>{children}</span>
      <span aria-hidden='true' className='min-w-6 flex-1 border-t border-border' />
    </div>
  )
}

export function SeamIcon({
  icon: Icon,
  tone,
}: {
  icon: ComponentType<{ className?: string }>
  tone?: string
}) {
  return (
    <span className={cn('flex shrink-0', tone)}>
      <Icon className='size-3.5' />
    </span>
  )
}

// An action inside a seam (Resume): text that brightens on hover, sized to the seam's line.
export function ChatSeamAction({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant='ghost-text'
      size='xs'
      className={cn('h-6 px-1 text-sm font-normal text-foreground', className)}
      {...props}
    />
  )
}

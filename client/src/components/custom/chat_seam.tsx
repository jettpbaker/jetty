import type { ReactNode } from 'react'

import { cn } from 'cn'

// A divider across the transcript that carries a short state between messages: queued, paused,
// compacted, a report arriving. Hairlines either side; the content stays one line.
export function ChatSeam({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-6 min-w-0 items-center gap-3 text-xs text-muted-foreground',
        className
      )}
    >
      <span aria-hidden='true' className='min-w-6 flex-1 border-t border-border' />
      <span className='flex min-w-0 items-center gap-1.5'>{children}</span>
      <span aria-hidden='true' className='min-w-6 flex-1 border-t border-border' />
    </div>
  )
}

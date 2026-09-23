import type { ComponentProps, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The sidebar, Threads tab and pull request rows: a title with its status glyph over a meta line.
export function TwoLineRow({
  heading,
  glyph,
  children,
  className,
  variant = 'ghost',
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  heading: ReactNode
  glyph: ReactNode
  children: ReactNode
}) {
  return (
    <Button
      data-overflow-hover
      variant={variant}
      {...props}
      className={cn(
        'h-auto w-full min-w-0 flex-col items-stretch gap-1.5 rounded-sm px-2.5 py-1.5 text-left font-normal active:translate-y-0',
        className
      )}
    >
      <span className='flex min-w-0 items-center justify-between gap-3 text-foreground'>
        {heading}
        {glyph}
      </span>
      <span className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
        {children}
      </span>
    </Button>
  )
}

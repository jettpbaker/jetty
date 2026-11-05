import type { ComponentProps, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The sidebar, Threads tab and pull request rows: a title with its status glyph over a meta line.
export function TwoLineRow({
  heading,
  glyph,
  children,
  className,
  metaClassName,
  variant = 'ghost',
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  heading: ReactNode
  glyph: ReactNode
  children: ReactNode
  metaClassName?: string
}) {
  return (
    <Button
      data-overflow-hover
      variant={variant}
      {...props}
      className={cn(
        'h-auto min-h-10 w-full min-w-0 flex-col items-stretch gap-0.75 rounded-sm px-2.5 py-1 text-left font-normal',
        className
      )}
    >
      <span className='flex min-w-0 items-start gap-2 text-foreground'>
        <span className='mt-0.5 flex size-4 shrink-0 items-center justify-center'>{glyph}</span>
        {heading}
      </span>
      <span
        className={cn(
          'flex min-w-0 items-center gap-1.5 pl-6 text-xs text-muted-foreground',
          metaClassName
        )}
      >
        {children}
      </span>
    </Button>
  )
}

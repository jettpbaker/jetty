import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Input as InputPrimitive } from '@base-ui/react/input'

export function GhostInput({
  className,
  icon,
  ...props
}: ComponentProps<'input'> & { icon?: ReactNode }) {
  return (
    <label className='flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground'>
      {icon && (
        <span aria-hidden='true' className='flex shrink-0 items-center'>
          {icon}
        </span>
      )}
      <InputPrimitive
        data-slot='ghost-input'
        className={cn(
          'h-7 w-full min-w-0 border-0 bg-transparent p-0 text-xs text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    </label>
  )
}

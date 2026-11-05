import type { ReactNode } from 'react'

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

import type { Icon } from './central_icons'

export function ContentEmpty({
  icon: Glyph,
  title,
  description,
  children,
  className,
}: {
  icon: Icon
  title: string
  description: string
  children?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn('min-h-64 px-5', className)}>
      <EmptyHeader className='max-w-70'>
        <EmptyMedia className='mb-1'>
          <Glyph aria-hidden='true' className='size-5 text-muted-foreground' />
        </EmptyMedia>
        <EmptyTitle className='text-sm tracking-normal'>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  )
}

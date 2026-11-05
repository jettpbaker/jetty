import type { ReactNode } from 'react'

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

import type { Icon } from './central_icons'

export function ContentEmpty({
  icon: Glyph,
  title,
  description,
  children,
}: {
  icon: Icon
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <Empty className='min-h-full'>
      <EmptyHeader>
        <EmptyMedia>
          <Glyph aria-hidden='true' className='size-5 text-muted-foreground' />
        </EmptyMedia>
        <EmptyTitle className='text-sm tracking-normal'>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  )
}

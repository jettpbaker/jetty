import type { ComponentProps } from 'react'

import { ThreadStatusGlyph, type ThreadStatus } from '@/components/custom/thread_status'
import { TabsTrigger } from '@/components/ui/tabs'

import { OverflowTitle } from './overflow_title'

type ThreadTabProps = Omit<ComponentProps<typeof TabsTrigger>, 'children' | 'title' | 'variant'> & {
  title: string
  status: ThreadStatus
}

export function ThreadTab({ title, status, ...props }: ThreadTabProps) {
  return (
    <TabsTrigger data-overflow-hover variant='thread' {...props}>
      <ThreadStatusGlyph status={status} iconClassName='size-glyph' />
      <OverflowTitle focusable={false} className='text-left font-normal leading-normal'>
        {title}
      </OverflowTitle>
    </TabsTrigger>
  )
}

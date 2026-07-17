import type { ThreadItem } from '@jetty/shared/items'

import { Virtuoso } from 'react-virtuoso'

import { TimelineItem } from './timeline-item'

export function Timeline({ threadId, items }: { threadId: string; items: ThreadItem[] }) {
  return (
    <Virtuoso
      key={threadId}
      className='flex-1'
      data={items}
      computeItemKey={(_index, item) => item.id}
      followOutput='smooth'
      initialTopMostItemIndex={Math.max(0, items.length - 1)}
      itemContent={(_index, item) => (
        <div className='mx-auto w-full max-w-3xl px-4 py-2'>
          <TimelineItem item={item} />
        </div>
      )}
    />
  )
}

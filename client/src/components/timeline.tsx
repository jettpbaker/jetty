import type { ThreadItem } from '@jetty/shared/items'

import { useLayoutEffect, useRef } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

import { TimelineItem } from './timeline-item'

export function Timeline({ threadId, items }: { threadId: string; items: ThreadItem[] }) {
  const virtuoso = useRef<VirtuosoHandle>(null)

  // Jump (not animate) to the newest item when switching threads. Layout effect
  // so it lands before paint — no flash of the previous thread's scroll offset.
  useLayoutEffect(() => {
    virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
  }, [threadId])

  return (
    <Virtuoso
      ref={virtuoso}
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

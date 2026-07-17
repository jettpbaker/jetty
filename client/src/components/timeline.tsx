import type { ThreadItem } from '@jetty/shared/items'

import { useLayoutEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

import { TimelineItem } from './timeline-item'

export function Timeline({ threadId, items }: { threadId: string; items: ThreadItem[] }) {
  const virtuoso = useRef<VirtuosoHandle>(null)

  // On thread switch the new items commit at the old scroll offset, and
  // Virtuoso can only jump after measuring them — 1-2 frames of wrong
  // position. Hide (not unmount: hidden keeps layout, so measuring works)
  // until the jump has landed, then reveal.
  const [settledThread, setSettledThread] = useState(threadId)
  const switching = settledThread !== threadId

  useLayoutEffect(() => {
    if (!switching) return
    const t0 = performance.now()
    console.log(`[jetty-scroll] switch → ${threadId.slice(-6)}: hidden, jumping`)
    virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        console.log(
          `[jetty-scroll] switch → ${threadId.slice(-6)}: revealed +${(performance.now() - t0).toFixed(0)}ms`
        )
        setSettledThread(threadId)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [switching, threadId])

  return (
    <div className='min-h-0 flex-1' style={{ visibility: switching ? 'hidden' : 'visible' }}>
      <Virtuoso
        ref={virtuoso}
        className='h-full'
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
    </div>
  )
}

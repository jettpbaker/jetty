import type { ThreadItem } from '@jetty/shared/items'

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { cn } from '@/lib/utils'
import { useRef } from 'react'

import { TimelineItem } from './timeline-item'

export function Timeline({ threadId, items }: { threadId: string; items: ThreadItem[] }) {
  // Items present when a thread is first shown render static; only items that
  // arrive while watching get the enter animation.
  const seenRef = useRef<{ threadId: string; ids: Set<string> } | null>(null)
  if (seenRef.current?.threadId !== threadId) {
    seenRef.current = { threadId, ids: new Set(items.map((item) => item.id)) }
  }
  const initialIds = seenRef.current.ids

  // Keyed so the provider remounts per thread and re-runs defaultScrollPosition.
  return (
    <MessageScrollerProvider key={threadId} autoScroll defaultScrollPosition='last-anchor'>
      <MessageScroller className='min-h-0 flex-1'>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            {items.map((item) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                scrollAnchor={item.kind === 'user_message'}
              >
                <div
                  className={cn(
                    'mx-auto w-full max-w-3xl px-4 py-2',
                    !initialIds.has(item.id) && 'item-enter'
                  )}
                >
                  <TimelineItem item={item} threadId={threadId} />
                </div>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

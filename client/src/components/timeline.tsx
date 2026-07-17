import type { ThreadItem } from '@jetty/shared/items'

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'

import { TimelineItem } from './timeline-item'

export function Timeline({ threadId, items }: { threadId: string; items: ThreadItem[] }) {
  // Keyed by threadId so the provider remounts per thread, re-running
  // defaultScrollPosition="end" to land at the bottom of the new thread.
  return (
    <MessageScrollerProvider key={threadId} autoScroll defaultScrollPosition='end'>
      <MessageScroller className='min-h-0 flex-1'>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            {items.map((item) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                scrollAnchor={item.kind === 'user_message'}
              >
                <div className='mx-auto w-full max-w-3xl px-4 py-2'>
                  <TimelineItem item={item} />
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

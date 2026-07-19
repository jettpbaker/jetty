import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { turnSpinnerVerb } from '@/lib/spinner-verb'
import { cn } from '@/lib/utils'
import { useRef } from 'react'

import { ContextGroupRow, groupTimeline } from './context-group'
import { TimelineItem } from './timeline-item'

// Spacing encodes grouping: consecutive work items (tool calls, reasoning)
// cluster into one activity block; messages keep conversation-scale air.
const WORK_KINDS: ReadonlySet<ThreadItem['kind']> = new Set(['tool_call', 'reasoning'])

export function Timeline({
  threadId,
  items,
  status = 'idle',
  activeTurnId = null,
  overlayInset = false,
}: {
  threadId: string
  items: ThreadItem[]
  status?: SessionStatus
  activeTurnId?: string | null
  /** Clearance for a composer floating over the viewport bottom. */
  overlayInset?: boolean
}) {
  // Items present when a thread is first shown render static; only items that
  // arrive while watching get the enter animation.
  const seenRef = useRef<{ threadId: string; ids: Set<string> } | null>(null)
  if (seenRef.current?.threadId !== threadId) {
    seenRef.current = { threadId, ids: new Set(items.map((item) => item.id)) }
  }
  const initialIds = seenRef.current.ids
  const entries = groupTimeline(items)

  // Optimistic activity: the turn is running but nothing has streamed yet
  // (block order isn't guaranteed — this is a generic "working" row, not a
  // reasoning item; it shares the turn's spinner verb so if reasoning does
  // arrive first the row morphs in place).
  const lastItem = items[items.length - 1]
  const turnPending = status === 'running' && (!lastItem || lastItem.kind === 'user_message')

  // Keyed so the provider remounts per thread and re-runs defaultScrollPosition.
  return (
    <MessageScrollerProvider key={threadId} autoScroll defaultScrollPosition='end'>
      <MessageScroller className='min-h-0 flex-1'>
        <MessageScrollerViewport>
          <MessageScrollerContent className={cn('gap-0', overlayInset && 'pb-36')}>
            {entries.map((entry, index) => {
              if (entry.kind === 'context-group') {
                const firstId = entry.items[0]!.id
                const live = status === 'running' && index === entries.length - 1
                return (
                  <MessageScrollerItem key={firstId} messageId={firstId}>
                    <div
                      className={cn(
                        'mx-auto w-full max-w-3xl px-4 py-2',
                        !initialIds.has(firstId) && 'item-enter',
                      )}
                    >
                      <ContextGroupRow items={entry.items} live={live} />
                    </div>
                  </MessageScrollerItem>
                )
              }

              const { item } = entry
              return (
                <MessageScrollerItem key={item.id} messageId={item.id}>
                  <div
                    className={cn(
                      'mx-auto w-full max-w-3xl px-4',
                      WORK_KINDS.has(item.kind) ? 'py-2' : 'py-3',
                      !initialIds.has(item.id) && 'item-enter',
                    )}
                  >
                    <TimelineItem item={item} threadId={threadId} />
                  </div>
                </MessageScrollerItem>
              )
            })}
            {turnPending ? (
              <MessageScrollerItem key='turn-pending' messageId='turn-pending'>
                <div className='item-enter mx-auto w-full max-w-3xl px-4 py-2'>
                  <span className='shimmer shimmer-duration-1000 text-sm text-muted-foreground'>
                    {turnSpinnerVerb(activeTurnId ?? threadId)}
                  </span>
                </div>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          className={overlayInset ? 'data-[direction=end]:bottom-36' : undefined}
        />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

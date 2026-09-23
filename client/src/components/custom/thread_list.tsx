import type { ThreadItem } from '@jetty/shared/items'

import { AssistantMessage } from '@/components/custom/assistant_message'
import { clearTextMeasure, estimateItem } from '@/components/custom/thread_measure'
import { UserMessage } from '@/components/custom/user_message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const pinSlack = 96

function contentWidth(scrollerWidth: number) {
  return Math.max(1, Math.min(708, scrollerWidth) - 48)
}

function itemStamp(item: ThreadItem) {
  switch (item.kind) {
    case 'assistant_message':
    case 'plan':
    case 'reasoning':
      return `${item.text.length}:${item.streaming ?? false}`
    case 'tool_call':
      return `${item.output.length}:${item.status}`
    case 'user_message':
      return item.text.length
    case 'error':
      return item.message.length
    default:
      return item.kind
  }
}

function ThreadItemRow({ item }: { item: ThreadItem }) {
  if (item.kind === 'user_message')
    return <UserMessage text={item.text} attachments={item.attachments} />
  if (item.kind === 'assistant_message' || item.kind === 'plan')
    return (
      <Message align='start'>
        <MessageContent>
          <Bubble variant='ghost' align='start'>
            <BubbleContent>
              {item.kind === 'plan' && <p className='mb-1 text-xs text-muted-foreground'>Plan</p>}
              <AssistantMessage text={item.text} streaming={item.streaming} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  if (item.kind === 'reasoning')
    return (
      <p className='text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground'>
        {item.text}
      </p>
    )
  if (item.kind === 'error') return <p className='text-sm text-destructive'>{item.message}</p>
  return <p className='text-xs text-muted-foreground'>{item.kind}</p>
}

export function ThreadList({ items }: { items: readonly ThreadItem[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [width, setWidth] = useState(660)
  const [fontsReady, setFontsReady] = useState(false)

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(contentWidth(element.clientWidth)))
    observer.observe(element)
    setWidth(contentWidth(element.clientWidth))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (cancelled) return
      clearTextMeasure()
      setFontsReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => estimateItem(items[index]!, width, fontsReady ? 1 : 0),
    overscan: 10,
    gap: 12,
    getItemKey: (index) => items[index]!.id,
  })

  const stamp = items.map(itemStamp).join('|')

  useLayoutEffect(() => {
    if (!pinned.current || items.length === 0) return
    virtualizer.scrollToIndex(items.length - 1, { align: 'end' })
  }, [virtualizer, items.length, stamp])

  return (
    <section
      ref={scroller}
      className='scrollbar-subtle scroll-fade-y min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none'
      aria-label='Conversation'
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the page does not scroll, so this scrollport has to be focusable
      tabIndex={0}
      onScroll={() => {
        const element = scroller.current
        if (!element) return
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < pinSlack
      }}
    >
      <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className='absolute top-0 left-0 w-full'
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <div className='mx-auto w-full max-w-[708px] px-6'>
              <ThreadItemRow item={items[virtualRow.index]!} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

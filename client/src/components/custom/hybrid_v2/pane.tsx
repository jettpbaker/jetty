import type { ThreadState } from '@jetty/shared/reducer'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { ChatSettledContext, useChatSettled } from '@/lib/chat-feel'
import { useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'

import { createThreadRows, singleTurnRows } from '../thread_rows'
import { TurnSurface } from './turn'
import './style.css'

type PaneProps = { thread: ThreadState; threadId: string; projectPath?: string; now: number }

export function HybridV2Pane(props: PaneProps) {
  const settled = useChatSettled()
  const reduced = useReducedMotion()
  return (
    <ChatSettledContext value={settled || !!reduced}>
      <Pane {...props} />
    </ChatSettledContext>
  )
}

function Pane({ thread, threadId, projectPath, now }: PaneProps) {
  const [build] = useState(createThreadRows)
  const rows = singleTurnRows(
    build(thread.items, {
      status: thread.status,
      running: thread.activeTurnId !== null,
      outcomes: thread.turnOutcomes,
      loadouts: thread.turnLoadouts,
      projectPath,
      threadId,
    }),
    thread.items
  )
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const settled = useChatSettled()
  useLayoutEffect(() => {
    const scroller = scrollerRef.current!
    function pin() {
      if (pinned.current) scroller.scrollTop = scroller.scrollHeight
    }
    pin()
    const observer = new ResizeObserver(pin)
    observer.observe(contentRef.current!)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (settled) {
      pinned.current = true
      scrollerRef.current!.scrollTop = scrollerRef.current!.scrollHeight
    }
  }, [settled, thread])
  return (
    <div
      ref={scrollerRef}
      aria-label='Conversation'
      data-chat-thread
      data-hybrid-v2
      className='flex min-h-0 flex-1 flex-col overflow-y-auto'
      onWheel={(event) => {
        if (event.deltaY < 0) pinned.current = false
      }}
      onTouchStart={() => {
        pinned.current = false
      }}
      onScroll={(event) => {
        const scroller = event.currentTarget
        if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2)
          pinned.current = true
      }}
    >
      <div
        ref={contentRef}
        className='mx-auto mt-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 py-6'
      >
        {rows.map((row, index) => {
          if (row.kind === 'user')
            return (
              <div key={row.id} data-chat-row='user' className='flex justify-end'>
                <Bubble>
                  <BubbleContent className='whitespace-pre-wrap'>{row.item.text}</BubbleContent>
                </Bubble>
              </div>
            )
          if (row.kind !== 'work') return null
          const next = rows[index + 1]
          return (
            <TurnSurface
              key={row.id}
              work={row}
              answer={next?.kind === 'assistant' || next?.kind === 'plan' ? next : undefined}
              threadId={threadId}
              now={now}
            />
          )
        })}
      </div>
    </div>
  )
}

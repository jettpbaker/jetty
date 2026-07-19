import type { ThreadItem } from '@jetty/shared/items'

import { socket, tabsStore, timelineStore } from '@/app-state'
import { ApprovalDock } from '@/components/approval-dock'
import { Composer } from '@/components/composer'
import { DiffPanel } from '@/components/diff-panel'
import { Timeline } from '@/components/timeline'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pressHandlers } from '@/lib/press-handlers'
import { pendingSends } from '@/state/pending'
import { GitDiffIcon } from '@phosphor-icons/react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

function pendingApproval(items: ThreadItem[]): Extract<ThreadItem, { kind: 'approval' }> | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!
    if (item.kind === 'approval' && item.decision === undefined) return item
  }
  return undefined
}

export const Route = createFileRoute('/thread/$threadId')({
  component: ThreadPage,
})

function ThreadPage() {
  const { threadId } = Route.useParams()

  // A pending send at first sight of a thread means we arrived from a draft
  // submit — only that arrival gets the soft entrance; switching threads stays
  // instant.
  const arriveRef = useRef<{ threadId: string; arrive: boolean } | null>(null)
  if (arriveRef.current?.threadId !== threadId) {
    arriveRef.current = { threadId, arrive: pendingSends.get(threadId) !== undefined }
  }

  useEffect(() => {
    tabsStore.open(threadId)
    timelineStore.openThread(threadId)
    return () => {
      timelineStore.closeThread(threadId)
    }
  }, [threadId])

  const state = useSyncExternalStore(timelineStore.subscribe, () =>
    timelineStore.getSnapshot(threadId)
  )

  const [diffOpen, setDiffOpen] = useState(false)

  const approval = state.status === 'awaiting_approval' ? pendingApproval(state.items) : undefined

  return (
    <div className='flex h-full'>
      <div
        className={cn(
          'relative flex h-full min-w-0 flex-1 flex-col',
          arriveRef.current.arrive && 'page-arrive'
        )}
      >
        <Timeline
          threadId={threadId}
          items={state.items}
          status={state.status}
          activeTurnId={state.activeTurnId}
          overlayInset
        />
        {!diffOpen ? (
          <Button
            variant='ghost'
            size='icon'
            className='absolute right-3 top-3 z-20 size-8'
            aria-label='Show diff'
            {...pressHandlers(() => setDiffOpen(true))}
          >
            <GitDiffIcon />
          </Button>
        ) : null}
        {/* floats over the scrolling timeline so the frosted composer has content
            to blur; pointer-events split keeps the gutter click-through */}
        <div className='pointer-events-none absolute inset-x-0 bottom-0 z-10'>
          <div className='pointer-events-auto mx-auto w-full max-w-3xl p-4'>
            {approval ? (
              <ApprovalDock
                item={approval}
                respond={(decision, message) =>
                  socket.request('approval.respond', {
                    threadId,
                    itemId: approval.id,
                    decision,
                    message,
                  })
                }
              />
            ) : (
              <Composer threadId={threadId} status={state.status} />
            )}
          </div>
        </div>
      </div>
      {diffOpen ? <DiffPanel threadId={threadId} onClose={() => setDiffOpen(false)} /> : null}
    </div>
  )
}

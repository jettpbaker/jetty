import { timelineStore } from '@/app-state'
import { Composer } from '@/components/composer'
import { Timeline } from '@/components/timeline'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { pendingSends } from '@/state/pending'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useSyncExternalStore } from 'react'

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
    timelineStore.openThread(threadId)
    return () => {
      timelineStore.closeThread(threadId)
    }
  }, [threadId])

  const state = useSyncExternalStore(timelineStore.subscribe, () =>
    timelineStore.getSnapshot(threadId)
  )

  return (
    <div className={cn('flex h-full flex-col', arriveRef.current.arrive && 'page-arrive')}>
      <header className='flex h-12 shrink-0 items-center border-b px-2'>
        <SidebarTrigger />
      </header>
      <Timeline threadId={threadId} items={state.items} />
      <div className='mx-auto w-full max-w-3xl shrink-0 p-4'>
        <Composer threadId={threadId} status={state.status} />
      </div>
    </div>
  )
}

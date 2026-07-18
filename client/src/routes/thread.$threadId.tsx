import { timelineStore } from '@/app-state'
import { Composer } from '@/components/composer'
import { Timeline } from '@/components/timeline'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useSyncExternalStore } from 'react'

export const Route = createFileRoute('/thread/$threadId')({
  component: ThreadPage,
})

function ThreadPage() {
  const { threadId } = Route.useParams()

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
    <div className='flex h-full flex-col'>
      <header className='flex h-12 shrink-0 items-center border-b px-2'>
        <SidebarTrigger />
      </header>
      <Timeline threadId={threadId} items={state.items} />
      <div className='mx-auto w-full max-w-3xl shrink-0 p-4 [view-transition-name:composer]'>
        <Composer threadId={threadId} status={state.status} />
      </div>
    </div>
  )
}

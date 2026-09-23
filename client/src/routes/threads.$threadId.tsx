import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { ThreadList } from '@/components/custom/thread_list'
import { useThread } from '@/state'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/threads/$threadId')({ component: Thread })

function Thread() {
  const { threadId } = Route.useParams()
  const thread = useThread(threadId)
  return (
    <section className='flex h-full min-h-0 flex-col' aria-label='Thread'>
      <PageSidebarTrigger standalone />
      {!thread ? (
        <p className='px-6 py-6 text-sm text-muted-foreground'>Loading…</p>
      ) : thread.items.length === 0 ? (
        <p className='px-6 py-6 text-sm text-muted-foreground'>No messages yet.</p>
      ) : (
        <ThreadList key={threadId} items={thread.items} />
      )}
    </section>
  )
}

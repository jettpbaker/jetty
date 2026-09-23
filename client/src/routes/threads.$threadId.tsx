import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { useThread } from '@/state'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/threads/$threadId')({ component: Thread })

function Thread() {
  const { threadId } = Route.useParams()
  const thread = useThread(threadId)
  return (
    <>
      <PageSidebarTrigger standalone />
      <p className='p-4 text-sm'>
        {thread
          ? `${thread.items.length} items · ${thread.status} · seq ${thread.lastSeq}`
          : 'Loading…'}
      </p>
    </>
  )
}

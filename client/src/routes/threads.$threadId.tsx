import { useThread } from '@/state'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/threads/$threadId')({ component: Thread })

function Thread() {
  const { threadId } = Route.useParams()
  const thread = useThread(threadId)
  return (
    <main className='flex flex-col gap-4 p-4'>
      <Link to='/'>Back</Link>
      {thread ? (
        <p>
          {thread.items.length} items · {thread.status} · seq {thread.lastSeq}
        </p>
      ) : (
        <p>Loading…</p>
      )}
    </main>
  )
}

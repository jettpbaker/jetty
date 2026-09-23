import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { ThreadComposer } from '@/components/custom/thread_composer'
import { ThreadDetailsLayout } from '@/components/custom/thread_details_layout'
import { ThreadHeader } from '@/components/custom/thread_header'
import { ThreadList } from '@/components/custom/thread_list'
import { useRespondApproval, useRespondQuestion, useThread, useThreadOverlay } from '@/state'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/threads/$threadId')({ component: Thread })

function Thread() {
  const { threadId } = Route.useParams()
  const thread = useThread(threadId)
  const overlay = useThreadOverlay(threadId, thread)
  const respondApproval = useRespondApproval()
  const respondQuestion = useRespondQuestion()
  const composer = (
    <ThreadComposer
      threadId={threadId}
      items={thread?.items ?? []}
      running={overlay.running}
      rows={overlay.empty ? 2 : 1}
    />
  )
  return (
    <section className='flex h-full min-h-0 flex-col' aria-label='Thread'>
      {overlay.empty && <PageSidebarTrigger standalone />}
      {overlay.empty ? (
        thread ? (
          <div className='flex min-h-0 flex-1 flex-col justify-center'>{composer}</div>
        ) : (
          <p className='px-6 py-6 text-sm text-muted-foreground'>Loading…</p>
        )
      ) : (
        <ThreadDetailsLayout>
          <ThreadHeader context={thread?.context ?? null} />
          <ThreadList
            key={threadId}
            items={overlay.items}
            status={thread?.status ?? 'idle'}
            onApproval={(itemId, approved) =>
              respondApproval(threadId, itemId, approved ? 'allow' : 'deny')
            }
            onAnswer={(itemId, answers) => respondQuestion(threadId, itemId, answers)}
          />
          {composer}
        </ThreadDetailsLayout>
      )}
    </section>
  )
}

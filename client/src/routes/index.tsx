import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { ThreadComposer } from '@/components/custom/thread_composer'
import { useDraftEpoch } from '@/state'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const epoch = useDraftEpoch()
  return (
    <section key={epoch} className='flex h-full min-h-0 flex-col' aria-label='New thread'>
      <PageSidebarTrigger standalone />
      <div className='relative z-10 flex min-h-0 flex-1 flex-col justify-center'>
        <ThreadComposer running={false} rows={2} ambient />
      </div>
    </section>
  )
}

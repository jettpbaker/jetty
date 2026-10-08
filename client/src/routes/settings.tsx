import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { createFileRoute, Outlet, useParams } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({ component: Settings })

// Each page opens at its top: the scroller is the page's own.
function Settings() {
  const page = useParams({ strict: false }).page
  return (
    <div className='flex h-full min-h-0 flex-col bg-background' aria-label='Settings'>
      <PageSidebarTrigger standalone />
      <div
        key={page}
        className='scroll-fade-y scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain px-4'
      >
        <Outlet />
      </div>
    </div>
  )
}

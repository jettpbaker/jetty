import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({ component: Settings })

function Settings() {
  return (
    <>
      <PageSidebarTrigger standalone />
      <p className='p-4 text-sm text-muted-foreground'>Settings are coming soon.</p>
    </>
  )
}

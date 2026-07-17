import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <div className='flex h-full flex-col'>
      <header className='flex h-12 shrink-0 items-center border-b px-2'>
        <SidebarTrigger />
      </header>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Pick a thread to get started</EmptyTitle>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

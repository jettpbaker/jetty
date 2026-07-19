import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <div className='flex h-full flex-col'>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Pick a thread to get started</EmptyTitle>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

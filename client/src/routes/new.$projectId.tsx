import { DraftComposer } from '@/components/composer'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/$projectId')({
  component: NewThreadPage,
})

function NewThreadPage() {
  const { projectId } = Route.useParams()

  return (
    <div className='flex h-full flex-col'>
      <header className='flex h-12 shrink-0 items-center border-b px-2'>
        <SidebarTrigger />
      </header>
      <div className='flex-1' />
      <div className='mx-auto w-full max-w-3xl shrink-0 p-4'>
        <DraftComposer key={projectId} projectId={projectId} />
      </div>
    </div>
  )
}

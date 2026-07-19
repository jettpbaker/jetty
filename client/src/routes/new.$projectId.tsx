import { DraftComposer } from '@/components/composer'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/$projectId')({
  component: NewThreadPage,
})

function NewThreadPage() {
  const { projectId } = Route.useParams()

  return (
    <div className='flex h-full flex-col'>
      <div className='flex flex-1 items-center justify-center p-4'>
        <div className='w-full max-w-3xl'>
          <DraftComposer key={projectId} projectId={projectId} />
        </div>
      </div>
    </div>
  )
}

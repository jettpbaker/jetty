import { DraftComposer } from '@/components/composer'
import { RansomWordmark } from '@/components/ransom-wordmark'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new/$projectId')({
  component: NewThreadPage,
})

function NewThreadPage() {
  const { projectId } = Route.useParams()

  return (
    <div className='flex h-full flex-col'>
      {/* anchored so the block's visual center sits at the ~38% optical center,
          and a growing draft extends downward without shifting the wordmark */}
      <div className='flex flex-1 items-start justify-center p-4 pt-[24vh]'>
        <div className='w-full max-w-3xl'>
          <RansomWordmark className='mb-10' />
          <DraftComposer key={projectId} projectId={projectId} />
        </div>
      </div>
    </div>
  )
}

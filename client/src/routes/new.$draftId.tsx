import { draftsStore } from '@/app-state'
import { DraftComposer } from '@/components/composer'
import { RansomWordmark } from '@/components/ransom-wordmark'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

export const Route = createFileRoute('/new/$draftId')({
  component: NewThreadPage,
})

function NewThreadPage() {
  const { draftId } = Route.useParams()
  const drafts = useSyncExternalStore(draftsStore.subscribe, draftsStore.getSnapshot)
  const draft = drafts.find((row) => row.id === draftId)

  if (!draft) return <Navigate to='/' />

  return (
    <div className='flex h-full flex-col'>
      {/* anchored so the block's visual center sits at the ~38% optical center,
          and a growing draft extends downward without shifting the wordmark */}
      <div className='flex flex-1 items-start justify-center p-4 pt-[24vh]'>
        <div className='w-full max-w-3xl'>
          <RansomWordmark className='mb-10' />
          <DraftComposer key={draftId} draftId={draftId} projectId={draft.projectId} />
        </div>
      </div>
    </div>
  )
}

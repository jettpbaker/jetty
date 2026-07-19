import { DraftComposer } from '@/components/composer'
import { RansomWordmark, type RansomWordmarkHandle } from '@/components/ransom-wordmark'
import { Button } from '@/components/ui/button'
import { pressHandlers } from '@/lib/press-handlers'
import { PlayIcon } from '@phosphor-icons/react'
import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'

export const Route = createFileRoute('/new/$projectId')({
  component: NewThreadPage,
})

function NewThreadPage() {
  const { projectId } = Route.useParams()
  const wordmarkRef = useRef<RansomWordmarkHandle>(null)

  return (
    <div className='relative flex h-full flex-col'>
      {/* temporary demo control: previews the scatter that will play on submit */}
      <Button
        variant='ghost'
        size='icon'
        aria-label='Play scatter animation'
        className='absolute top-3 right-3'
        {...pressHandlers(() => wordmarkRef.current?.scatter())}
      >
        <PlayIcon />
      </Button>
      <div className='flex flex-1 items-center justify-center p-4'>
        <div className='w-full max-w-3xl'>
          <RansomWordmark ref={wordmarkRef} className='mb-10' />
          <DraftComposer key={projectId} projectId={projectId} />
        </div>
      </div>
    </div>
  )
}

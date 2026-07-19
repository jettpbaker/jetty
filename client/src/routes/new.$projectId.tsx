import { composerShell, DraftComposer } from '@/components/composer'
import { RansomWordmark, type RansomWordmarkHandle } from '@/components/ransom-wordmark'
import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input-group'
import { Message, MessageContent } from '@/components/ui/message'
import { pressHandlers } from '@/lib/press-handlers'
import { PlayIcon } from '@phosphor-icons/react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/new/$projectId')({
  component: NewThreadPage,
})

// how long the fake thread holds before resetting to the draft
const DEMO_HOLD_MS = 1600

function NewThreadPage() {
  const { projectId } = Route.useParams()
  const wordmarkRef = useRef<RansomWordmarkHandle>(null)
  // temporary demo: previews the submit hand-off — the swap to the thread is
  // INSTANT while the scatter plays over it from a body-level overlay, exactly
  // as the real submit will behave. No routing, stores, or server involved.
  const [demo, setDemo] = useState<'idle' | 'thread'>('idle')

  useEffect(() => {
    if (demo !== 'thread') return
    const timer = window.setTimeout(() => setDemo('idle'), DEMO_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [demo])

  if (demo === 'thread') return <FakeThread />

  return (
    <div className='relative flex h-full flex-col'>
      <Button
        variant='ghost'
        size='icon'
        aria-label='Play submit animation'
        className='absolute top-3 right-3'
        {...pressHandlers(() => {
          wordmarkRef.current?.scatter()
          setDemo('thread')
        })}
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

// Static lookalike of the thread page a submit lands on, playing the same
// page-arrive and item-enter animations the real one does.
function FakeThread() {
  return (
    <div className='page-arrive flex h-full flex-col'>
      <div className='mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end px-4 pt-4'>
        <div className='item-enter'>
          <Message align='end'>
            <MessageContent>ship the ransom wordmark</MessageContent>
          </Message>
        </div>
      </div>
      <div className='mx-auto w-full max-w-3xl shrink-0 p-4'>
        <div className={composerShell}>
          <InputGroup>
            <div className='px-3 py-2.5 text-muted-foreground text-sm'>Message the agent…</div>
          </InputGroup>
        </div>
      </div>
    </div>
  )
}

import { DraftComposer } from '@/components/composer'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'

export const Route = createFileRoute('/new/$projectId')({
  component: NewThreadPage,
})

function NewThreadPage() {
  const { projectId } = Route.useParams()
  // the glow layer renders into this container, behind the page content
  const glowContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={glowContainerRef} className='relative isolate flex h-full flex-col bg-black'>
      <header className='flex h-12 shrink-0 items-center border-b px-2'>
        <SidebarTrigger />
      </header>
      <div className='flex flex-1 items-center justify-center p-4'>
        <div className='w-full max-w-3xl'>
          <DraftComposer
            key={projectId}
            projectId={projectId}
            glowContainerRef={glowContainerRef}
          />
        </div>
      </div>
    </div>
  )
}

import type { SessionStatus } from '@jetty/shared/events'

import { chromeStore, tabsStore } from '@/app-state'
import { NewProjectDialog } from '@/components/new-project-dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { pressHandlers } from '@/lib/press-handlers'
import { cn } from '@/lib/utils'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function statusDotClass(status: SessionStatus): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'animate-pulse bg-primary'
    case 'awaiting_approval':
      return 'bg-primary'
    case 'error':
      return 'bg-destructive'
    case 'idle':
      return 'bg-muted-foreground/40'
  }
}

function HomePage() {
  const chrome = useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot)
  const navigate = useNavigate()

  function openThread(threadId: string) {
    tabsStore.open(threadId)
    void navigate({ to: '/thread/$threadId', params: { threadId } })
  }

  const groups = chrome.projects.flatMap((project) => {
    const threads = chrome.threads.filter(
      (thread) => thread.projectId === project.id && !thread.archived
    )
    if (threads.length === 0) return []
    return [{ project, threads }]
  })

  if (groups.length === 0) {
    return (
      <div className='flex h-full flex-col'>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No threads yet</EmptyTitle>
            <EmptyDescription>Create a project to start a thread.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewProjectDialog />
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-md flex-col gap-6 p-8'>
        {groups.map(({ project, threads }) => (
          <section key={project.id} className='flex flex-col gap-1'>
            <h2 className='px-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
              {project.title}
            </h2>
            <ul className='flex flex-col gap-0.5'>
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type='button'
                    className='flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted'
                    {...pressHandlers(() => openThread(thread.id))}
                  >
                    <span
                      className={cn('size-2 shrink-0 rounded-full', statusDotClass(thread.status))}
                    />
                    <span className='min-w-0 truncate'>{thread.title || thread.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <NewProjectDialog />
      </div>
    </div>
  )
}

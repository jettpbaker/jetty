import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadMeta } from '@jetty/shared/wire'

import { chromeStore, socket, tabsStore } from '@/app-state'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pressHandlers } from '@/lib/press-handlers'
import { cn } from '@/lib/utils'
import { GearIcon, ListIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState, useSyncExternalStore, type ReactElement } from 'react'

import { NewProjectDialog } from './new-project-dialog'

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

function IconTip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TabBar() {
  const chrome = useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot)
  const tabIds = useSyncExternalStore(tabsStore.subscribe, tabsStore.getSnapshot)
  const navigate = useNavigate()
  const { threadId: activeThreadId, projectId: draftProjectId } = useParams({ strict: false })
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  const threadById = new Map(chrome.threads.map((thread) => [thread.id, thread]))
  const openTabs = tabIds
    .map((id) => threadById.get(id))
    .filter((thread): thread is ThreadMeta => thread !== undefined && !thread.archived)
  const openIds = openTabs.map((thread) => thread.id)
  const activeThread = activeThreadId ? threadById.get(activeThreadId) : undefined
  const newThreadProjectId =
    activeThread?.projectId ?? chrome.projects[0]?.id

  function openThread(threadId: string) {
    tabsStore.open(threadId)
    void navigate({ to: '/thread/$threadId', params: { threadId } })
  }

  function newThread(projectId: string) {
    void navigate({ to: '/new/$projectId', params: { projectId } })
  }

  function neighborOf(threadId: string): string | null {
    const index = openIds.indexOf(threadId)
    if (index === -1) return null
    return openIds[index + 1] ?? openIds[index - 1] ?? null
  }

  function closeTab(threadId: string) {
    const wasActive = threadId === activeThreadId
    const next = wasActive ? neighborOf(threadId) : null
    tabsStore.close(threadId)
    if (!wasActive) return
    if (next) {
      void navigate({ to: '/thread/$threadId', params: { threadId: next } })
    } else {
      void navigate({ to: '/' })
    }
  }

  function archiveTab(threadId: string) {
    closeTab(threadId)
    void socket.request('thread.archive', { threadId })
  }

  return (
    <div className='flex h-12 shrink-0 items-center gap-2 border-b px-3'>
      <Link
        to='/'
        aria-label='Jetty home'
        className='shrink-0 text-base text-foreground'
        style={{ fontFamily: "'Geist Pixel Square'" }}
      >
        Jetty
      </Link>

      <div className='flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {openTabs.map((thread) => {
          const active = thread.id === activeThreadId
          return (
            <ContextMenu key={thread.id}>
              <ContextMenuTrigger
                className={cn(
                  'group relative flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm',
                  active
                    ? 'border-border bg-secondary text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-secondary/50'
                )}
              >
                <button
                  type='button'
                  aria-label={thread.title || thread.id}
                  className='absolute inset-0 rounded-md'
                  {...pressHandlers(() => openThread(thread.id))}
                />
                <span
                  className={cn(
                    'pointer-events-none relative size-2 shrink-0 rounded-full',
                    statusDotClass(thread.status)
                  )}
                />
                <span className='pointer-events-none relative max-w-40 truncate'>
                  {thread.title || thread.id}
                </span>
                <button
                  type='button'
                  aria-label='Close tab'
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(thread.id)
                  }}
                  className={cn(
                    'relative z-10 -mr-1 rounded-sm p-0.5 text-muted-foreground hover:text-foreground',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <XIcon className='size-3.5' />
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => closeTab(thread.id)}>Close</ContextMenuItem>
                <ContextMenuItem onClick={() => archiveTab(thread.id)}>Archive</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
        {draftProjectId !== undefined && (
          <div className='flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 text-sm text-foreground'>
            <span className='max-w-40 truncate'>New thread</span>
          </div>
        )}
        <IconTip label='New thread'>
          <Button
            variant='ghost'
            size='icon'
            className='size-8 shrink-0'
            aria-label='New thread'
            disabled={newThreadProjectId === undefined}
            {...(newThreadProjectId
              ? pressHandlers(() => newThread(newThreadProjectId))
              : {})}
          >
            <PlusIcon />
          </Button>
        </IconTip>
      </div>

      <div className='flex shrink-0 items-center gap-1'>
        <DropdownMenu>
          <IconTip label='All threads'>
            <DropdownMenuTrigger
              render={
                <Button variant='ghost' size='icon' aria-label='All threads'>
                  <ListIcon />
                </Button>
              }
            />
          </IconTip>
          <DropdownMenuContent align='end' className='max-h-96 w-64'>
            {chrome.projects.map((project) => {
              const threads = chrome.threads.filter(
                (thread) => thread.projectId === project.id && !thread.archived
              )
              if (threads.length === 0) return null
              return (
                <DropdownMenuGroup key={project.id}>
                  <DropdownMenuLabel className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
                    {project.title}
                  </DropdownMenuLabel>
                  {threads.map((thread) => (
                    <DropdownMenuItem key={thread.id} onClick={() => openThread(thread.id)}>
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          statusDotClass(thread.status)
                        )}
                      />
                      <span className='truncate'>{thread.title || thread.id}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
              New project…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <IconTip label='Settings'>
          <Button
            variant='ghost'
            size='icon'
            render={
              <Link to='/settings' aria-label='Settings'>
                <GearIcon />
              </Link>
            }
          />
        </IconTip>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        showTrigger={false}
      />
    </div>
  )
}

import type { SessionStatus } from '@jetty/shared/events'

import { chromeStore, socket } from '@/app-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { historyBackWithFallback } from '@/lib/history-back'
import { pressHandlers } from '@/lib/press-handlers'
import { cn } from '@/lib/utils'
import { ArrowLeftIcon, DotsThreeIcon, GearIcon, PlusIcon } from '@phosphor-icons/react'
import { Link, useLocation, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

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

export function AppSidebar() {
  const chrome = useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot)
  const navigate = useNavigate()
  const router = useRouter()
  const onSettings = useLocation({ select: (location) => location.pathname === '/settings' })
  const { threadId: activeThreadId } = useParams({ strict: false })

  function openThread(threadId: string) {
    void navigate({ to: '/thread/$threadId', params: { threadId } })
  }

  function newThread(projectId: string) {
    void navigate({ to: '/new/$projectId', params: { projectId } })
  }

  async function archiveThread(threadId: string) {
    await socket.request('thread.archive', { threadId })
    if (threadId === activeThreadId) {
      void navigate({ to: '/' })
    }
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <NewProjectDialog />
      </SidebarHeader>
      <SidebarContent>
        {chrome.projects.map((project) => {
          const threads = chrome.threads.filter(
            (thread) => thread.projectId === project.id && !thread.archived
          )
          return (
            <SidebarGroup key={project.id}>
              <SidebarGroupLabel className='font-mono text-[10px] uppercase tracking-widest'>
                {project.title}
              </SidebarGroupLabel>
              <SidebarGroupAction
                title='New thread'
                {...pressHandlers(() => newThread(project.id))}
              >
                <PlusIcon />
                <span className='sr-only'>New thread</span>
              </SidebarGroupAction>
              <SidebarGroupContent>
                <SidebarMenu>
                  {threads.map((thread) => (
                    <SidebarMenuItem key={thread.id}>
                      <SidebarMenuButton
                        isActive={thread.id === activeThreadId}
                        {...pressHandlers(() => openThread(thread.id))}
                      >
                        <span
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            statusDotClass(thread.status)
                          )}
                        />
                        <span className='truncate'>{thread.title || thread.id}</span>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <SidebarMenuAction showOnHover>
                              <DotsThreeIcon />
                              <span className='sr-only'>Thread actions</span>
                            </SidebarMenuAction>
                          }
                        />
                        <DropdownMenuContent side='right' align='start'>
                          <DropdownMenuItem onClick={() => void archiveThread(thread.id)}>
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
        {chrome.projects.length === 0 && (
          <p className='px-4 py-2 text-muted-foreground text-sm'>No projects yet.</p>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {onSettings ? (
              <SidebarMenuButton {...pressHandlers(() => historyBackWithFallback(router))}>
                <ArrowLeftIcon />
                <span>Back</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                render={
                  <Link to='/settings'>
                    <GearIcon />
                    <span>Settings</span>
                  </Link>
                }
              />
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

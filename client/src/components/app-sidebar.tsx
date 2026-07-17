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
import { Link, useLocation, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon, MoreHorizontalIcon, PlusIcon, SettingsIcon } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'

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

  const openThread = useCallback(
    (threadId: string) => {
      void navigate({ to: '/thread/$threadId', params: { threadId } })
    },
    [navigate]
  )

  const createThread = useCallback(
    async (projectId: string) => {
      const { thread } = await socket.request('thread.create', { projectId })
      void navigate({ to: '/thread/$threadId', params: { threadId: thread.id } })
    },
    [navigate]
  )

  const archiveThread = useCallback(
    async (threadId: string) => {
      await socket.request('thread.archive', { threadId })
      if (threadId === activeThreadId) void navigate({ to: '/' })
    },
    [navigate, activeThreadId]
  )

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
              <SidebarGroupLabel>{project.title}</SidebarGroupLabel>
              <SidebarGroupAction
                title='New thread'
                {...pressHandlers(() => void createThread(project.id))}
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
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction showOnHover>
                            <MoreHorizontalIcon />
                            <span className='sr-only'>Thread actions</span>
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side='right' align='start'>
                          <DropdownMenuItem onSelect={() => void archiveThread(thread.id)}>
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
              <SidebarMenuButton asChild>
                <Link to='/settings'>
                  <SettingsIcon />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

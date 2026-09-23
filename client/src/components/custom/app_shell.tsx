import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { Tabs, TabsList } from '@/components/ui/tabs'
import { storage } from '@/platform'
import { useChrome } from '@/state'
import { useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import { AppSidebar } from './app_sidebar'
import { PageSidebarTriggerContext } from './page_sidebar_trigger'
import { ShellNavigation, ShellNavigationSpace } from './shell_navigation'
import { SidebarResizeHandle } from './sidebar_resize_handle'
import { threadStatus } from './thread_status'
import { ThreadTab } from './thread_tab'
import './app_shell.css'

const widthKey = 'jetty.sidebar.width'
const openKey = 'jetty.sidebar.open'

// Tabs are per-thread views (main + subagents). They stay hidden until the backend emits subagent events.
const showThreadTabs = false

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(storage.get(widthKey)) || 250)
  const [open, setOpen] = useState(() => storage.get(openKey) !== 'false')

  function changeWidth(width: number) {
    setSidebarWidth(width)
    storage.set(widthKey, String(width))
  }

  function changeOpen(next: boolean) {
    setOpen(next)
    storage.set(openKey, String(next))
  }

  return (
    <SidebarProvider
      open={open}
      onOpenChange={changeOpen}
      className='h-dvh min-h-0 overflow-hidden bg-sidebar text-foreground'
      style={
        {
          '--sidebar-width': `${sidebarWidth}px`,
          '--app-tab-bar-height': '42px',
        } as CSSProperties
      }
    >
      <Workspace sidebarWidth={sidebarWidth} onSidebarWidthChange={changeWidth}>
        {children}
      </Workspace>
    </SidebarProvider>
  )
}

// Sidebar context changes must not rerender every thread and navigation row.
const Workspace = memo(function Workspace({
  sidebarWidth,
  onSidebarWidthChange,
  children,
}: {
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { setOpenMobile } = useSidebar()
  const pathname = useLocation({ select: (location) => location.pathname })
  const threadId = useParams({ strict: false }).threadId
  const thread = useChrome()?.threads.find((entry) => entry.id === threadId)

  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])

  useEffect(() => {
    function openSettings(event: KeyboardEvent) {
      if (
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key !== ',' ||
        event.isComposing
      )
        return
      event.preventDefault()
      if (event.repeat) return
      void navigate({ to: '/settings' })
    }
    window.addEventListener('keydown', openSettings, true)
    return () => window.removeEventListener('keydown', openSettings, true)
  }, [navigate])

  return (
    <PageSidebarTriggerContext value={!showThreadTabs}>
      <Tabs
        value='main'
        className='app-workspace relative h-full min-w-0 flex-1 gap-0'
        data-thread-tabs={showThreadTabs}
      >
        <ShellNavigation />
        <header className='app-thread-bar shrink-0 overflow-hidden bg-sidebar'>
          <div className='flex h-(--app-tab-bar-height) items-center px-1.5 py-1.5'>
            <ShellNavigationSpace />
            <div
              className='app-thread-tabs no-scrollbar scroll-fade-x min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-1.5'
              data-visible={showThreadTabs}
              inert={!showThreadTabs}
              aria-hidden={!showThreadTabs}
            >
              <TabsList
                variant='thread'
                className='h-7.5 p-0 group-data-horizontal/tabs:h-7.5'
                aria-label='Thread views'
              >
                <ThreadTab
                  value='main'
                  title={thread?.title ?? 'Thread'}
                  status={thread ? threadStatus(thread.status) : 'idle'}
                />
              </TabsList>
            </div>
          </div>
        </header>
        <div className='flex min-h-0 flex-1'>
          <AppSidebar />
          <SidebarResizeHandle width={sidebarWidth} onWidthChange={onSidebarWidthChange} />
          <SidebarInset
            aria-label='Thread workspace'
            className='mx-2 mb-2 mt-0 min-h-0 min-w-0 overflow-hidden rounded-none bg-sidebar shadow-none md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2'
          >
            <div className='relative flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] bg-background'>
              {children}
            </div>
          </SidebarInset>
        </div>
      </Tabs>
    </PageSidebarTriggerContext>
  )
})

import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { storage } from '@/platform'
import {
  useBumpDraft,
  useConnectionNotice,
  useForgetDeletedDrafts,
  useRenewQueueHolds,
  useSettleUnsureSends,
} from '@/state'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useLocation, useMatches, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import { AppSidebar } from './app_sidebar'
import { FileDropOverlay } from './file_drop_overlay'
import { appShortcut, inDialog, keybinds } from './keybinds'
import { NewThreadBackdrop } from './new_thread_backdrop'
import { rememberAppLocation, SettingsSidebar } from './settings_sidebar'
import { ShellNavigation } from './shell_navigation'
import { SidebarResizeHandle } from './sidebar_resize_handle'
import './app_shell.css'

const widthKey = 'jetty.sidebar.width'
const openKey = 'jetty.sidebar.open'

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

function Workspace({
  sidebarWidth,
  onSidebarWidthChange,
  children,
}: {
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  const bumpDraft = useBumpDraft()
  const { setOpenMobile, open, isMobile } = useSidebar()
  const pathname = useMatches({ select: (matches) => matches.at(-1)?.pathname ?? '/' })
  const href = useLocation({ select: (location) => location.href })
  // Settings is its own mode: its nav takes the sidebar, and "Back to app" replaces the toggles.
  const onSettings = pathname.startsWith('/settings')
  const onNewThreadPage = pathname === '/'

  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile])
  // By the location, not the match: it changes first, while the next page's code loads.
  useEffect(() => {
    if (!href.startsWith('/settings')) rememberAppLocation(href)
  }, [href])
  useRenewQueueHolds()
  useForgetDeletedDrafts()
  useSettleUnsureSends()
  useConnectionNotice()

  useHotkey(
    keybinds.settings.hotkey,
    (event) => {
      if (!inDialog(event)) void navigate({ to: '/settings' })
    },
    { requireReset: true, ignoreInputs: false }
  )
  // The thread sidebar unmounts on Settings, so this lives with the shell. The sidebar button
  // calls the same two steps.
  useHotkey(
    keybinds.newThread.hotkey,
    (event) => {
      if (!appShortcut(event)) return
      bumpDraft()
      void navigate({ to: '/' })
    },
    { requireReset: true, ignoreInputs: false }
  )

  return (
    <div className='app-workspace relative flex h-full min-w-0 flex-1 flex-col'>
      {!(onSettings && open && !isMobile) && <ShellNavigation />}
      <header className='app-thread-bar shrink-0 bg-sidebar' />
      <div className='flex min-h-0 flex-1'>
        {onSettings ? <SettingsSidebar /> : <AppSidebar />}
        <SidebarResizeHandle width={sidebarWidth} onWidthChange={onSidebarWidthChange} />
        <SidebarInset
          aria-label='Thread workspace'
          className='mx-2 mb-2 mt-0 min-h-0 min-w-0 overflow-hidden rounded-none bg-sidebar shadow-none md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2'
        >
          <div className='relative flex h-full min-h-0 flex-col overflow-clip rounded-[12px] bg-background'>
            <div
              className='new-thread-backdrop-shell'
              data-visible={onNewThreadPage || undefined}
              aria-hidden={!onNewThreadPage}
            >
              <NewThreadBackdrop visible={onNewThreadPage} />
            </div>
            {children}
            <FileDropOverlay />
          </div>
        </SidebarInset>
      </div>
    </div>
  )
}

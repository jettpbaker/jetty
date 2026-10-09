import type { SubagentStatus } from '@jetty/shared/items'

import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { Tabs, TabsList } from '@/components/ui/tabs'
import { chatFeelNames, cycleChatFeel } from '@/lib/chat-feel'
import { storage } from '@/platform'
import {
  MAIN_TAB,
  useConnectionNotice,
  useForgetDeletedDrafts,
  useRenewQueueHolds,
  useSettleUnsureSends,
  useSubagentOutcome,
  useSubagentTabs,
  useThreadMeta,
  useThreadTab,
  type SubagentTab,
} from '@/state'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useLocation, useMatches, useNavigate, useParams } from '@tanstack/react-router'
import { useReducedMotion } from 'motion/react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { toast } from 'sonner'

import { AppSidebar } from './app_sidebar'
import { FileDropOverlay } from './file_drop_overlay'
import { inDialog, keybinds } from './keybinds'
import { NewThreadBackdrop } from './new_thread_backdrop'
import { PageSidebarTriggerContext } from './page_sidebar_trigger'
import { rememberAppLocation, SettingsSidebar } from './settings_sidebar'
import { ShellNavigation, ShellNavigationSpace } from './shell_navigation'
import { SidebarResizeHandle } from './sidebar_resize_handle'
import { beatMs, exitMs, reducedExitMs } from './subagent_finish'
import { subagentLabel } from './thread_rows'
import { threadStatus, type ThreadStatus } from './thread_status'
import { ThreadTab } from './thread_tab'
import './app_shell.css'

const widthKey = 'jetty.sidebar.width'
const openKey = 'jetty.sidebar.open'

function subagentTabStatus(tab: SubagentTab): ThreadStatus {
  if (tab.needsInput) return 'needs-attention'
  if (tab.status === 'running') return 'working'
  if (tab.status === 'failed') return 'error'
  return tab.status === 'completed' ? 'ready' : 'idle'
}

// A tab whose subagent ended out of view holds its done colour for a beat, then shrinks away.
type StripTab = SubagentTab & { leaving?: 'beat' | 'pending' | 'exit'; titleWidth?: number }

const wash = { duration: 600, delay: 120 }

function staying(tab: StripTab) {
  return !tab.leaving || tab.leaving === 'beat'
}

// Keep each tab where it was; a viewed tab that already finished leaves without a second beat.
function settleTabs(
  tabs: readonly StripTab[],
  agents: readonly SubagentTab[],
  outcome: (id: string) => SubagentStatus | undefined
): StripTab[] {
  const listed = new Map(agents.map((agent) => [agent.id, agent]))
  const next: StripTab[] = []
  for (const tab of tabs) {
    const agent = listed.get(tab.id)
    listed.delete(tab.id)
    if (agent) next.push(agent)
    else if (tab.leaving) next.push(tab)
    else if (tab.status !== 'running') next.push({ ...tab, leaving: 'pending' })
    else {
      const status = outcome(tab.id)
      if (status && status !== 'running') next.push({ ...tab, status, leaving: 'beat' })
    }
  }
  return [...next, ...listed.values()]
}

// The main tab takes a brief wash of the outcome's colour as a result lands.
function washMainTab(main: HTMLElement, status: SubagentStatus) {
  const base = getComputedStyle(main).backgroundColor
  const token = getComputedStyle(main)
    .getPropertyValue(status === 'completed' ? '--status-success' : '--status-error')
    .trim()
  main.animate(
    [{ backgroundColor: `color-mix(in oklab, ${token} 22%, ${base})` }, { backgroundColor: base }],
    { duration: wash.duration, delay: wash.delay, easing: 'ease-out' }
  )
}

function useFinishingTabs(
  threadId: string | undefined,
  agents: readonly SubagentTab[],
  scrollerRef: RefObject<HTMLDivElement | null>
) {
  const outcome = useSubagentOutcome(threadId)
  const reducedMotion = useReducedMotion()
  const [state, setState] = useState({ threadId, agents, tabs: agents as readonly StripTab[] })
  let tabs = state.tabs
  if (state.threadId !== threadId || state.agents !== agents) {
    tabs = state.threadId === threadId ? settleTabs(state.tabs, agents, outcome) : agents
    setState({ threadId, agents, tabs })
  }
  const timers = useRef(new Map<string, number>())
  const scrollTo = useRef<number>(undefined)

  function update(change: (tabs: readonly StripTab[]) => StripTab[]) {
    setState((current) => ({ ...current, tabs: change(current.tabs) }))
  }

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [threadId])

  useEffect(() => {
    for (const tab of tabs) {
      const key = `${tab.id}:${tab.leaving}`
      if (!tab.leaving || tab.leaving === 'pending' || timers.current.has(key)) continue
      const later = (ms: number, run: () => void) =>
        timers.current.set(
          key,
          window.setTimeout(() => {
            timers.current.delete(key)
            run()
          }, ms)
        )
      if (tab.leaving === 'beat' && tab.status !== 'running')
        later(beatMs[tab.status], () =>
          update((current) =>
            current.map((entry) =>
              entry.id === tab.id && entry.leaving === 'beat'
                ? { ...entry, leaving: 'pending' }
                : entry
            )
          )
        )
      if (tab.leaving === 'exit')
        later(reducedMotion ? reducedExitMs : exitMs, () =>
          update((current) =>
            current.filter((entry) => entry.id !== tab.id || entry.leaving !== 'exit')
          )
        )
    }
  }, [tabs, reducedMotion])

  // A tab that leaves from off-screen left goes at once; keep what's on screen still.
  useLayoutEffect(() => {
    if (scrollTo.current === undefined || !scrollerRef.current) return
    scrollerRef.current.scrollLeft = scrollTo.current
    scrollTo.current = undefined
  }, [tabs, scrollerRef])

  // Measure as the exit starts: the title's width to hold, and whether the tab is on screen at all.
  // The last tab out goes with the bar's own exit instead.
  useLayoutEffect(() => {
    if (!tabs.some((tab) => tab.leaving === 'pending')) return
    const strip = scrollerRef.current
    const view = strip?.getBoundingClientRect()
    const list = strip?.firstElementChild
    const gap = list ? Number.parseFloat(getComputedStyle(list).columnGap) || 0 : 0
    const main = strip?.querySelector<HTMLElement>('[data-main-tab]')
    const alone = !tabs.some(staying)
    const widths = new Map<string, number>()
    let shift = 0
    for (const tab of tabs) {
      if (tab.leaving !== 'pending') continue
      const element = strip?.querySelector<HTMLElement>(`[data-agent="${CSS.escape(tab.id)}"]`)
      const rect = element?.getBoundingClientRect()
      if (alone || !element || !rect || !view || rect.left >= view.right) continue
      if (rect.right <= view.left) {
        shift += rect.width + gap
        continue
      }
      widths.set(
        tab.id,
        element.querySelector('.overflow-title')?.getBoundingClientRect().width ?? 0
      )
      if (main && (tab.status === 'completed' || tab.status === 'failed'))
        washMainTab(main, tab.status)
    }
    if (shift && strip) scrollTo.current = strip.scrollLeft - shift
    update((current) =>
      current.flatMap((tab) => {
        if (tab.leaving !== 'pending') return [tab]
        const titleWidth = widths.get(tab.id)
        return titleWidth === undefined ? [] : [{ ...tab, leaving: 'exit' as const, titleWidth }]
      })
    )
  }, [tabs, scrollerRef])

  return tabs
}

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
  const { setOpenMobile, open, isMobile } = useSidebar()
  const pathname = useMatches({ select: (matches) => matches.at(-1)?.pathname ?? '/' })
  const href = useLocation({ select: (location) => location.href })
  // Settings is its own mode: its nav takes the sidebar, and "Back to app" replaces the toggles.
  const onSettings = pathname.startsWith('/settings')
  const threadId = useParams({ strict: false }).threadId
  const thread = useThreadMeta(threadId)
  const agents = useSubagentTabs(threadId)
  const [tab, setTab] = useThreadTab(threadId ?? '')
  const scroller = useRef<HTMLDivElement>(null)
  const strip = useFinishingTabs(threadId, agents, scroller)
  const showThreadTabs = strip.some(staying)
  const [lastTabbed, setLastTabbed] = useState({ thread, strip })
  if (showThreadTabs && (lastTabbed.thread !== thread || lastTabbed.strip !== strip))
    setLastTabbed({ thread, strip })
  // Retain the outgoing tabs until the strip has finished fading away.
  const tabbed = showThreadTabs ? { thread, strip } : lastTabbed
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
  useHotkey(
    keybinds.chatFeel.hotkey,
    () => toast(`Chat feel: ${chatFeelNames[cycleChatFeel()]}`, { id: 'chat-feel' }),
    { requireReset: true, ignoreInputs: false }
  )

  return (
    <PageSidebarTriggerContext value={!showThreadTabs}>
      <Tabs
        value={showThreadTabs && agents.some((agent) => agent.id === tab) ? tab : MAIN_TAB}
        onValueChange={(value) => {
          if (typeof value === 'string') setTab(value)
        }}
        className='app-workspace relative h-full min-w-0 flex-1 gap-0'
        data-thread-tabs={showThreadTabs}
      >
        {!(onSettings && open && !isMobile) && <ShellNavigation />}
        <header className='app-thread-bar shrink-0 overflow-hidden bg-sidebar'>
          <div className='flex h-(--app-tab-bar-height) items-center px-1.5 py-1.5'>
            <ShellNavigationSpace />
            <div
              ref={scroller}
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
                  value={MAIN_TAB}
                  data-main-tab
                  title={tabbed.thread?.title ?? 'Thread'}
                  status={
                    tabbed.thread
                      ? threadStatus(tabbed.thread.status, tabbed.thread.readyForReview)
                      : 'idle'
                  }
                />
                {tabbed.strip.map((agent) => (
                  <ThreadTab
                    key={agent.id}
                    value={agent.id}
                    data-agent={agent.id}
                    title={agent.title}
                    status={subagentTabStatus(agent)}
                    model={subagentLabel(agent)}
                    agentType='subagent'
                    leaving={
                      agent.leaving === 'exit' ? { titleWidth: agent.titleWidth ?? 0 } : undefined
                    }
                  />
                ))}
              </TabsList>
            </div>
          </div>
        </header>
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
      </Tabs>
    </PageSidebarTriggerContext>
  )
}

import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { effortLabels, modelKey } from '@/lib/loadout'
import { pressProps } from '@/lib/press'
import { formatAge } from '@/lib/time'
import {
  useArchiveThread,
  useBumpDraft,
  useChrome,
  useDeleteThread,
  usePinThread,
  usePrefetchThread,
  useRenameThread,
  type Chrome,
} from '@/state'
import { CircleIcon, GearSixIcon } from '@phosphor-icons/react'
import {
  ComposeIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  PinIcon,
  RepoIcon,
} from '@primer/octicons-react'
import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { SidebarThreadControls } from './sidebar_thread_controls'
import {
  groupSidebarThreads,
  type SidebarThread,
  type ThreadGrouping,
} from './sidebar_thread_groups'
import { ThreadHoverGroup } from './thread_hover'
import { ThreadRow } from './thread_row'
import { ThreadStatusGlyph, threadStatus } from './thread_status'

const MotionSidebarContent = motion.create(SidebarContent)
const rowLayoutTransition = { type: 'spring' as const, duration: 0.25, bounce: 0 }

const navigationButtonClass =
  'h-7 w-full justify-start gap-2 rounded-sm px-2.5 font-normal text-muted-foreground hover:bg-sidebar-accent hover:text-foreground aria-current:bg-sidebar-accent aria-current:text-foreground'

const comingSoon = [
  { label: 'Issues', icon: IssueOpenedIcon },
  { label: 'Pull requests', icon: GitPullRequestIcon },
] as const

function sidebarThreads(chrome: Chrome, now: number): SidebarThread[] {
  const projects = new Map(chrome.projects.map((project) => [project.id, project.title]))
  const models = new Map(chrome.models?.map((model) => [modelKey(model), model.name]))
  const titles = new Map(chrome.threads.map((thread) => [thread.id, thread.title]))
  return chrome.threads
    .filter((thread) => !thread.archived)
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      project: projects.get(thread.projectId) ?? '',
      parent: thread.parentThreadId && titles.get(thread.parentThreadId),
      status: threadStatus(thread.status),
      lastActivity: formatAge(thread.updatedAt, now),
      updatedAt: thread.updatedAt,
      pinned: thread.pinned,
      pullRequest: thread.git?.pr ?? undefined,
      provider: thread.provider,
      model:
        thread.provider && thread.model
          ? (models.get(modelKey({ provider: thread.provider, id: thread.model })) ?? thread.model)
          : undefined,
      effort: thread.effort && effortLabels[thread.effort],
    }))
}

export function AppSidebar() {
  const chrome = useChrome()
  const now = useNow(60_000)
  const navigate = useNavigate()
  const selectedId = useParams({ strict: false }).threadId
  const onSettings = useLocation({ select: (location) => location.pathname === '/settings' })
  const reducedMotion = useReducedMotion()
  const [query, setQuery] = useState('')
  const [grouping, setGrouping] = useState<ThreadGrouping>('date')
  const [showPinned, setShowPinned] = useState(true)
  const [warmId, setWarmId] = useState<string | undefined>()
  const hovering = useRef<string | undefined>(undefined)
  const warmed = usePrefetchThread(warmId)

  useEffect(() => {
    if (warmed && hovering.current !== warmId) setWarmId(undefined)
  }, [warmed, warmId])

  const threads = chrome ? sidebarThreads(chrome, now) : []
  const groups = groupSidebarThreads(threads, grouping, query, showPinned)
  const layoutDependency = `${grouping}:${showPinned}:${threads.map((thread) => `${thread.id}:${thread.project}:${thread.status}:${thread.pinned}:${thread.updatedAt}`).join(',')}`
  const items = groups.flatMap((group) => [
    {
      kind: 'heading' as const,
      id: `heading:${group.id}`,
      label: group.label,
      pinned: group.pinned,
      count: group.threads.length,
      status: !group.pinned && grouping === 'status' ? group.threads[0]?.status : undefined,
    },
    ...group.threads.map((thread) => ({ kind: 'thread' as const, id: thread.id, thread })),
  ])
  const bumpDraft = useBumpDraft()
  const archiveThread = useArchiveThread()
  const renameThread = useRenameThread()
  const pinThread = usePinThread()
  const deleteThread = useDeleteThread()
  const openSettings = () => navigate({ to: '/settings' })

  function newThread() {
    bumpDraft()
    void navigate({ to: '/' })
  }

  function leaveIfSelected(threadId: string) {
    if (threadId === selectedId) void navigate({ to: '/' })
  }

  function archive(threadId: string) {
    archiveThread(threadId)
    leaveIfSelected(threadId)
  }

  function remove(threadId: string) {
    deleteThread(threadId)
    leaveIfSelected(threadId)
  }

  return (
    <Sidebar
      aria-label='Thread sidebar'
      className='top-(--app-tab-bar-height) h-[calc(100svh-var(--app-tab-bar-height))] p-0'
      variant='inset'
      collapsible='offcanvas'
    >
      <SidebarHeader className='shrink-0 gap-5 px-1.5 pb-4 pt-4'>
        <div className='flex items-center justify-between pl-2.5'>
          <Link to='/' className='text-base font-medium tracking-tight'>
            jetty
          </Link>
        </div>
        <nav aria-label='Main navigation'>
          <SidebarMenu className='gap-0.5'>
            <SidebarMenuItem>
              <Button variant='ghost' className={navigationButtonClass} {...pressProps(newThread)}>
                <ComposeIcon className='size-3' />
                New thread
              </Button>
            </SidebarMenuItem>
            {comingSoon.map(({ label, icon: Icon }) => (
              <SidebarMenuItem key={label}>
                <Tooltip>
                  <TooltipTrigger render={<span className='block cursor-not-allowed' />}>
                    <Button
                      variant='ghost'
                      className={`${navigationButtonClass} pointer-events-none`}
                      disabled
                    >
                      <Icon className='size-3' />
                      {label}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='right'>Coming soon</TooltipContent>
                </Tooltip>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarHeader>
      <div className='px-1.5 pb-4'>
        <SidebarThreadControls
          query={query}
          onQueryChange={setQuery}
          grouping={grouping}
          onGroupingChange={setGrouping}
          showPinned={showPinned}
          onShowPinnedChange={setShowPinned}
        />
      </div>
      <ThreadHoverGroup>
        <MotionSidebarContent layoutScroll className='overscroll-contain px-1.5 pb-0'>
          <nav aria-label='Threads'>
            <div className='flex flex-col [&>[data-thread-row]+[data-thread-row]]:mt-0.5'>
              {items.map((item) => {
                if (item.kind === 'heading')
                  return (
                    <h3
                      key={item.id}
                      className='mt-5 flex items-center gap-1.5 px-2.5 py-1 text-xs font-normal text-muted-foreground first:mt-0'
                    >
                      {item.pinned && <PinIcon className='size-3 shrink-0' aria-hidden='true' />}
                      {!item.pinned && grouping === 'project' && (
                        <RepoIcon
                          className='icon-optical-down size-3 shrink-0'
                          aria-hidden='true'
                        />
                      )}
                      {item.status === 'idle' ? (
                        <CircleIcon
                          weight='regular'
                          stroke='currentColor'
                          strokeWidth={16}
                          className='size-3 shrink-0'
                          aria-hidden='true'
                        />
                      ) : (
                        item.status && (
                          <ThreadStatusGlyph status={item.status} iconClassName='size-3' />
                        )
                      )}
                      <span className='flex min-w-0 flex-1 items-baseline gap-1'>
                        <span className='min-w-0 truncate font-medium'>{item.label}</span>
                        <span
                          className='ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums'
                          aria-label={`${item.count} threads`}
                        >
                          {item.count}
                        </span>
                      </span>
                    </h3>
                  )
                const thread = item.thread
                return (
                  <motion.div
                    key={thread.id}
                    data-thread-row
                    layout={reducedMotion ? false : 'position'}
                    layoutDependency={layoutDependency}
                    initial={false}
                    transition={{ layout: rowLayoutTransition }}
                    onPointerEnter={() => {
                      if (thread.id === selectedId) return
                      hovering.current = thread.id
                      setWarmId(thread.id)
                    }}
                    onPointerLeave={() => {
                      if (hovering.current !== thread.id) return
                      hovering.current = undefined
                      if (warmId === thread.id && warmed) setWarmId(undefined)
                    }}
                  >
                    <ThreadRow
                      {...thread}
                      selected={selectedId === thread.id}
                      actions={{
                        pinned: thread.pinned,
                        onArchive: () => archive(thread.id),
                        onDelete: () => remove(thread.id),
                        onPin: () => pinThread(thread.id, !thread.pinned),
                        onRename: (title) => renameThread(thread.id, title),
                      }}
                      onSelect={() =>
                        navigate({ to: '/threads/$threadId', params: { threadId: thread.id } })
                      }
                    />
                  </motion.div>
                )
              })}
              {chrome && !groups.length && (
                <p className='px-2.5 py-4 text-sm text-muted-foreground'>No threads found.</p>
              )}
            </div>
          </nav>
        </MotionSidebarContent>
      </ThreadHoverGroup>
      <SidebarFooter className='shrink-0 border-t border-sidebar-border p-0'>
        <Button
          variant='ghost'
          className='h-auto w-full justify-start gap-2 rounded-none px-4 py-2 font-normal text-muted-foreground enabled:hover:bg-sidebar-accent enabled:hover:text-foreground enabled:active:not-aria-[haspopup]:translate-y-0 aria-current:bg-sidebar-accent aria-current:text-foreground'
          aria-current={onSettings ? 'page' : undefined}
          aria-label='Settings'
          {...pressProps(openSettings)}
        >
          <GearSixIcon />
          Settings
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}

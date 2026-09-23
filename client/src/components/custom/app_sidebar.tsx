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
import { pressProps } from '@/lib/press'
import { formatAge } from '@/lib/time'
import { useArchiveThread, useChrome, useCreateThread, type Chrome } from '@/state'
import { CircleIcon, GearSixIcon } from '@phosphor-icons/react'
import { ComposeIcon, GitPullRequestIcon, IssueOpenedIcon, RepoIcon } from '@primer/octicons-react'
import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

import type { ThreadPullRequest, ThreadStatus } from './thread_row'

import { SidebarThreadControls } from './sidebar_thread_controls'
import { groupSidebarThreads, type ThreadGrouping } from './sidebar_thread_groups'
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

export type SidebarThread = {
  id: string
  title: string
  project: string
  status: ThreadStatus
  lastActivity: string
  updatedAt: number
  pullRequests: ThreadPullRequest[]
}

function newThreadProject(chrome: Chrome, selectedId: string | undefined) {
  const threads = chrome.threads.filter((thread) => !thread.archived)
  const selected = threads.find((thread) => thread.id === selectedId)
  const recent = threads.reduce<(typeof threads)[number] | undefined>(
    (latest, thread) => (!latest || thread.updatedAt > latest.updatedAt ? thread : latest),
    undefined
  )
  return (selected ?? recent)?.projectId ?? chrome.projects[0]?.id
}

function sidebarThreads(chrome: Chrome, now: number): SidebarThread[] {
  const projects = new Map(chrome.projects.map((project) => [project.id, project.title]))
  return chrome.threads
    .filter((thread) => !thread.archived)
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      project: projects.get(thread.projectId) ?? '',
      status: threadStatus(thread.status),
      lastActivity: formatAge(thread.updatedAt, now),
      updatedAt: thread.updatedAt,
      pullRequests: thread.git?.pr
        ? [
            {
              number: thread.git.pr.number,
              status: thread.git.pr.state,
              updatedAt: thread.updatedAt,
            },
          ]
        : [],
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
  const [grouping, setGrouping] = useState<ThreadGrouping>('project')
  const threads = chrome ? sidebarThreads(chrome, now) : []
  const groups = groupSidebarThreads(threads, grouping, query)
  const layoutDependency = `${grouping}:${threads.map((thread) => `${thread.id}:${thread.project}:${thread.status}:${thread.updatedAt}`).join(',')}`
  const items = groups.flatMap((group) => [
    {
      kind: 'heading' as const,
      id: `heading:${group.id}`,
      label: group.label,
      count: group.threads.length,
      status: grouping === 'status' ? group.threads[0]?.status : undefined,
    },
    ...group.threads.map((thread) => ({ kind: 'thread' as const, id: thread.id, thread })),
  ])
  const createThread = useCreateThread()
  const archiveThread = useArchiveThread()
  const projectId = chrome && newThreadProject(chrome, selectedId)
  const openSettings = () => navigate({ to: '/settings' })

  function newThread() {
    if (!projectId) return
    const threadId = createThread(projectId)
    void navigate({ to: '/threads/$threadId', params: { threadId } })
  }

  function archive(threadId: string) {
    archiveThread(threadId)
    if (threadId === selectedId) void navigate({ to: '/' })
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
              <Button
                variant='ghost'
                className={navigationButtonClass}
                disabled={!projectId}
                {...pressProps(newThread)}
              >
                <ComposeIcon className='size-3' />
                New thread
              </Button>
            </SidebarMenuItem>
            {comingSoon.map(({ label, icon: Icon }) => (
              <SidebarMenuItem key={label}>
                <Tooltip>
                  <TooltipTrigger render={<span className='block' />}>
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
        />
      </div>
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
                    {grouping === 'project' && (
                      <RepoIcon className='icon-optical-down size-3 shrink-0' aria-hidden='true' />
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
                >
                  <ThreadRow
                    {...thread}
                    selected={selectedId === thread.id}
                    actions={{ onArchive: () => archive(thread.id) }}
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

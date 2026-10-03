import type { PullRequestLink } from '@jetty/shared/wire'

import {
  CircleIcon,
  Settings01Icon,
  Archive02Icon,
  PencilEdit02Icon,
  PinIcon,
} from '@/components/custom/huge_icons'
import { GitPullRequestIcon, CircleDotIcon } from '@/components/custom/lucide_icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useNow } from '@/hooks/use-now'
import { effortLabels } from '@/lib/loadout'
import { pressProps } from '@/lib/press'
import { formatAge, formatElapsed } from '@/lib/time'
import { storage } from '@/platform'
import {
  useArchiveThread,
  useBumpDraft,
  useChrome,
  useDeleteThread,
  useOpenPullRequest,
  usePinThread,
  useThreadJourney,
  useThreadRowPrefetch,
  useRenameThread,
  type Chrome,
} from '@/state'
import { useWorktreeChanges } from '@/state/worktrees'
import { catalogModelName } from '@jetty/shared/model-name'
import { Link, useMatches, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { toast } from 'sonner'

import { DisabledTooltip } from './disabled_tooltip'
import { ProjectGlyph } from './project_glyph'
import { SidebarThreadControls } from './sidebar_thread_controls'
import {
  groupSidebarThreads,
  type SidebarThread,
  type ThreadGrouping,
} from './sidebar_thread_groups'
import { ThreadHoverGroup } from './thread_hover'
import { ThreadRow } from './thread_row'
import { StatusGlyph, threadStatus } from './thread_status'

const viewKey = 'jetty.sidebar.view'

type SidebarView = { grouping: ThreadGrouping; showPinned: boolean; showArchived: boolean }

function storedView(): SidebarView {
  let saved: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(storage.get(viewKey) ?? '{}')
    if (parsed && typeof parsed === 'object') saved = { ...parsed }
  } catch {}
  return {
    grouping: saved.grouping === 'project' || saved.grouping === 'status' ? saved.grouping : 'date',
    showPinned: saved.showPinned !== false,
    showArchived: saved.showArchived === true,
  }
}

const MotionSidebarContent = motion.create(SidebarContent)
const rowLayoutTransition = { type: 'spring' as const, duration: 0.25, bounce: 0 }

const navigationButtonClass =
  'h-7 w-full justify-start gap-2 rounded-sm px-2.5 font-normal text-muted-foreground hover:bg-sidebar-accent hover:text-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground'

function sidebarThreads(chrome: Chrome, now: number): SidebarThread[] {
  const projects = new Map(chrome.projects.map((project) => [project.id, project]))
  const titles = new Map(chrome.threads.map((thread) => [thread.id, thread.title]))
  return chrome.threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    project: projects.get(thread.projectId)?.title ?? '',
    projectId: thread.projectId,
    projectIcon: projects.get(thread.projectId)?.icon,
    parent: thread.parentThreadId && titles.get(thread.parentThreadId),
    status: threadStatus(thread.status, thread.readyForReview),
    lastActivity:
      thread.status === 'monitoring' && thread.backgroundTasks?.length
        ? formatElapsed(now - Math.min(...thread.backgroundTasks.map((task) => task.startedAt)))
        : formatAge(thread.updatedAt, now),
    environment: thread.environment,
    branch: thread.git?.branch ?? thread.worktree?.branch ?? undefined,
    updatedAt: thread.updatedAt,
    pinned: thread.pinned,
    archived: thread.archived,
    ...threadPullRequests(thread.pullRequests ?? []),
    provider: thread.provider,
    model:
      thread.provider && thread.model
        ? catalogModelName(chrome.models, thread.provider, thread.model)
        : undefined,
    effort: thread.effort && effortLabels[thread.effort],
  }))
}

const stateRank = { open: 0, draft: 1, merged: 2, closed: 3 }

// Only links GitHub has resolved count; a pending or not-found one mustn't hide the rest.
// The PR still in flight represents the thread when clicked, newest first within a state.
function threadPullRequests(links: readonly PullRequestLink[]) {
  const resolved = links.flatMap((link) =>
    link.state
      ? [
          {
            repo: link.repo,
            number: link.number,
            state: link.state,
            at: link.updatedAt ?? link.linkedAt,
          },
        ]
      : []
  )
  const latest = resolved.reduce<(typeof resolved)[number] | undefined>((best, link) => {
    if (!best) return link
    const rank = stateRank[link.state] - stateRank[best.state]
    if (rank !== 0) return rank < 0 ? link : best
    return link.at > best.at ? link : best
  }, undefined)
  return {
    pullRequests: resolved.map(({ repo, number, state }) => ({ repo, number, state })),
    pullRequest: latest && { repo: latest.repo, number: latest.number, state: latest.state },
  }
}

export function AppSidebar() {
  const chrome = useChrome()
  const now = useNow(60_000)
  const navigate = useNavigate()
  const router = useRouter()
  const selectedId = useParams({ strict: false }).threadId
  const pathname = useMatches({ select: (matches) => matches.at(-1)?.pathname ?? '/' })
  const onSettings = pathname === '/settings'
  const onPullRequests = pathname.startsWith('/pull-requests')
  const reducedMotion = useReducedMotion()
  const [deletePrompt, setDeletePrompt] = useState<{ threadId: string; count: number }>()
  const checkChanges = useWorktreeChanges()
  const [query, setQuery] = useState('')
  const [view, setView] = useState(storedView)
  const { grouping, showPinned, showArchived } = view
  function changeView(patch: Partial<SidebarView>) {
    const next = { ...view, ...patch }
    setView(next)
    storage.set(viewKey, JSON.stringify(next))
  }
  const prefetch = useThreadRowPrefetch()
  const openPullRequest = useOpenPullRequest()

  const threads = chrome ? sidebarThreads(chrome, now) : []
  const groups = groupSidebarThreads(threads, grouping, query, showPinned, showArchived)
  const layoutDependency = `${grouping}:${showPinned}:${showArchived}:${threads.map((thread) => `${thread.id}:${thread.project}:${thread.status}:${thread.pinned}:${thread.archived}:${thread.updatedAt}`).join(',')}`
  const items = groups.flatMap((group) => [
    {
      kind: 'heading' as const,
      id: `heading:${group.id}`,
      label: group.label,
      pinned: group.pinned,
      archived: group.archived,
      count: group.threads.length,
      status:
        !group.pinned && !group.archived && grouping === 'status'
          ? group.threads[0]?.status
          : undefined,
      projectIcon: group.threads[0]?.projectIcon,
    },
    ...group.threads.map((thread) => ({ kind: 'thread' as const, id: thread.id, thread })),
  ])
  const bumpDraft = useBumpDraft()
  const startThreadJourney = useThreadJourney()
  const archiveThread = useArchiveThread()
  const renameThread = useRenameThread()
  const pinThread = usePinThread()
  const deleteThread = useDeleteThread()
  const openSettings = () => navigate({ to: '/settings' })

  function newThread() {
    bumpDraft()
    void navigate({ to: '/' })
  }

  // Leaves a thread that's going away; the returned undo comes back to it if nothing else was opened.
  function leaveIfSelected(threadId: string) {
    if (threadId !== selectedId) return () => {}
    void navigate({ to: '/' })
    return () => {
      if (router.state.location.pathname === '/')
        void navigate({ to: '/threads/$threadId', params: { threadId } })
    }
  }

  // The server refuses a worktree with uncommitted changes; check first so we never claim success.
  function archive(threadId: string) {
    if (chrome?.threads.find((thread) => thread.id === threadId)?.environment !== 'worktree') {
      confirmArchive(threadId)
      return
    }
    checkChanges(threadId, (count) => {
      if (count > 0)
        toast.error(
          `Commit or discard ${count === 1 ? '1 uncommitted change' : `${count} uncommitted changes`} before archiving this worktree`
        )
      else confirmArchive(threadId)
    })
  }

  function confirmArchive(threadId: string) {
    archiveThread(threadId, true)
    const comeBack = leaveIfSelected(threadId)
    toast('Thread archived', {
      action: {
        label: 'Undo',
        onClick: () => {
          archiveThread(threadId, false)
          comeBack()
        },
      },
    })
  }

  function remove(threadId: string) {
    if (chrome?.threads.find((thread) => thread.id === threadId)?.environment !== 'worktree') {
      confirmRemove(threadId)
      return
    }
    checkChanges(threadId, (count) => {
      if (count > 0) setDeletePrompt({ threadId, count })
      else confirmRemove(threadId)
    })
  }

  function confirmRemove(threadId: string) {
    const deletion = deleteThread(threadId)
    const comeBack = leaveIfSelected(threadId)
    toast('Thread deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          deletion.undo()
          comeBack()
        },
      },
      onAutoClose: deletion.commit,
      onDismiss: deletion.commit,
    })
  }

  return (
    <Sidebar
      data-perf-region='sidebar'
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
                <PencilEdit02Icon className='size-3' />
                New thread
              </Button>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <DisabledTooltip reason='Coming soon' side='right' wrap='block'>
                <Button
                  variant='ghost'
                  className={`${navigationButtonClass} pointer-events-none`}
                  disabled
                >
                  <CircleDotIcon className='size-3' />
                  Issues
                </Button>
              </DisabledTooltip>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Button
                variant='ghost'
                className={navigationButtonClass}
                aria-current={onPullRequests ? 'page' : undefined}
                {...pressProps(() => navigate({ to: '/pull-requests' }))}
              >
                <GitPullRequestIcon className='size-3' />
                Pull requests
              </Button>
            </SidebarMenuItem>
          </SidebarMenu>
        </nav>
      </SidebarHeader>
      <div className='px-1.5 pb-4'>
        <SidebarThreadControls
          query={query}
          onQueryChange={setQuery}
          grouping={grouping}
          onGroupingChange={(next) => changeView({ grouping: next })}
          showPinned={showPinned}
          onShowPinnedChange={(next) => changeView({ showPinned: next })}
          showArchived={showArchived}
          onShowArchivedChange={(next) => changeView({ showArchived: next })}
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
                      {item.pinned && (
                        <PinIcon filled className='size-3 shrink-0' aria-hidden='true' />
                      )}
                      {item.archived && (
                        <Archive02Icon className='size-3 shrink-0' aria-hidden='true' />
                      )}
                      {!item.pinned && !item.archived && grouping === 'project' && (
                        <ProjectGlyph icon={item.projectIcon} className='size-3' />
                      )}
                      {item.status === 'idle' ? (
                        <CircleIcon className='size-3 shrink-0' aria-hidden='true' />
                      ) : (
                        item.status && <StatusGlyph status={item.status} className='size-3' />
                      )}
                      <span className='flex min-w-0 flex-1 items-baseline gap-1'>
                        <span className='min-w-0 truncate font-medium'>{item.label}</span>
                        <span
                          className='ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums'
                          aria-label={`${item.count} thread${item.count === 1 ? '' : 's'}`}
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
                      prefetch.enter(thread.id)
                    }}
                    onPointerLeave={() => prefetch.leave(thread.id)}
                  >
                    <ThreadRow
                      {...thread}
                      selected={selectedId === thread.id}
                      actions={{
                        pinned: thread.pinned,
                        archived: thread.archived,
                        onArchive: () =>
                          thread.archived ? archiveThread(thread.id, false) : archive(thread.id),
                        onDelete: () => remove(thread.id),
                        onPin: () => pinThread(thread.id, !thread.pinned),
                        onRename: (title) => renameThread(thread.id, title),
                      }}
                      onSelect={() => {
                        startThreadJourney(thread.id)
                        void navigate({ to: '/threads/$threadId', params: { threadId: thread.id } })
                      }}
                      onOpenPullRequest={() =>
                        thread.pullRequest && openPullRequest(thread.id, thread.pullRequest)
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
          className='h-auto w-full justify-start gap-2 rounded-none px-4 py-2 font-normal text-muted-foreground not-disabled:hover:bg-sidebar-accent not-disabled:hover:text-foreground not-disabled:active:not-aria-[haspopup]:translate-y-0 aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground'
          aria-current={onSettings ? 'page' : undefined}
          aria-label='Settings'
          {...pressProps(openSettings)}
        >
          <Settings01Icon />
          Settings
        </Button>
      </SidebarFooter>
      <Dialog
        open={Boolean(deletePrompt)}
        onOpenChange={(open) => {
          if (!open) setDeletePrompt(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete thread?</DialogTitle>
            <DialogDescription>
              {deletePrompt?.count} uncommitted changes in this thread&apos;s worktree will be lost
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeletePrompt(undefined)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (deletePrompt) confirmRemove(deletePrompt.threadId)
                setDeletePrompt(undefined)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}

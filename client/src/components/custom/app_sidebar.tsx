import {
  ArrowRight01Icon,
  ChartHistogramIcon,
  Settings01Icon,
  Archive02Icon,
  PencilEdit02Icon,
  PinIcon,
} from '@/components/custom/huge_icons'
import { GitPullRequestIcon, CircleDotIcon } from '@/components/custom/lucide_icons'
import { pullRequestListSearch } from '@/components/custom/pull_request_list_model'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { pressProps } from '@/lib/press'
import { isBoolean, useStoredState } from '@/lib/stored-state'
import { storage } from '@/platform'
import {
  useArchiveThread,
  useBumpDraft,
  useDeleteThread,
  useOpenPullRequest,
  usePinThread,
  useThreadJourney,
  useThreadRowPrefetch,
  useRenameThread,
  useRefreshPullRequestListsOnArrival,
} from '@/state'
import { threadTreeIds, useReadChrome, type Chrome } from '@/state/chrome'
import { usePrefetchProviderUsage } from '@/state/provider-usage'
import { useSidebarList, useSidebarRow } from '@/state/sidebar'
import { useWorktreeChanges } from '@/state/worktrees'
import { useHotkey, useHotkeys } from '@tanstack/react-hotkeys'
import { Link, useMatches, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { DisabledTooltip } from './disabled_tooltip'
import {
  HoverKeybind,
  KeybindIcon,
  KeybindTooltip,
  keybinds,
  appShortcut,
  type Keybind,
} from './keybinds'
import { ProjectGlyph } from './project_glyph'
import { SidebarThreadControls } from './sidebar_thread_controls'
import { sidebarGroups, sidebarThread, type ThreadGrouping } from './sidebar_thread_groups'
import { ThreadHoverGroup } from './thread_hover'
import { ThreadRow } from './thread_row'
import { StatusGlyph } from './thread_status'
import './app_sidebar.css'

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

function uncommitted(count: number) {
  return count === 1 ? '1 uncommitted change' : `${count} uncommitted changes`
}

export const AppSidebar = memo(function AppSidebar() {
  const readChrome = useReadChrome()
  const now = useNow(60_000)
  const navigate = useNavigate()
  const refreshPullRequestLists = useRefreshPullRequestListsOnArrival()
  const router = useRouter()
  const selectedId = useParams({ strict: false }).threadId
  const pathname = useMatches({ select: (matches) => matches.at(-1)?.pathname ?? '/' })
  const onSettings = pathname === '/settings'
  const onUsage = pathname === '/usage'
  const onPullRequests = pathname.startsWith('/pull-requests')
  const reducedMotion = useReducedMotion()
  const [deletePrompt, setDeletePrompt] = useState<{ threadId: string; count: number }>()
  const checkChanges = useWorktreeChanges()
  const [query, setQuery] = useState('')
  const [view, setView] = useState(storedView)
  const { grouping, showPinned, showArchived } = view
  const [archivedOpen, setArchivedOpen] = useStoredState(
    'jetty.sidebar.archivedOpen',
    false,
    isBoolean
  )
  function changeView(patch: Partial<SidebarView>) {
    const next = { ...view, ...patch }
    setView(next)
    storage.set(viewKey, JSON.stringify(next))
  }
  const prefetch = useThreadRowPrefetch()
  const prefetchUsage = usePrefetchProviderUsage()
  const openPullRequest = useOpenPullRequest()

  const list = useSidebarList()
  const groups = list && sidebarGroups(list, { ...view, query }, now)
  const numbered = (groups ?? [])
    .flatMap((group) => (group.archived ? [] : group.threads))
    .slice(0, keybinds.threads.length)
  const layoutDependency = `${grouping}:${showPinned}:${showArchived}:${archivedOpen}:${groups?.map((group) => `${group.id}:${group.threads.join(',')}`).join(';')}`
  const items = (groups ?? []).flatMap((group) => [
    { kind: 'heading' as const, ...group, id: `heading:${group.id}`, count: group.threads.length },
    ...(group.archived && !archivedOpen ? [] : group.threads).map((id) => ({
      kind: 'thread' as const,
      id,
      archived: group.archived,
    })),
  ])
  const bumpDraft = useBumpDraft()
  const startThreadJourney = useThreadJourney()
  const archiveThread = useArchiveThread()
  const renameThread = useRenameThread()
  const pinThread = usePinThread()
  const deleteThread = useDeleteThread()

  const openThread = useCallback(
    (threadId: string) => {
      startThreadJourney(threadId)
      void navigate({ to: '/threads/$threadId', params: { threadId } })
    },
    [startThreadJourney, navigate]
  )

  useHotkeys(
    keybinds.threads.flatMap((binding, index) => {
      const thread = numbered[index]
      return thread
        ? [
            {
              hotkey: binding.hotkey,
              callback: (event: KeyboardEvent) => {
                // ⌥-digit glyphs stay available in every text field except the composer.
                if (!appShortcut(event)) return
                event.preventDefault()
                openThread(thread)
              },
            },
          ]
        : []
    }),
    { requireReset: true, ignoreInputs: false, preventDefault: false }
  )

  useHotkey(
    keybinds.pin.hotkey,
    (event) => {
      const current = readChrome()?.threads.find((thread) => thread.id === selectedId)
      if (current && appShortcut(event)) pinThread(current.id, !current.pinned)
    },
    { enabled: selectedId !== undefined, requireReset: true, ignoreInputs: false }
  )

  function newThread() {
    bumpDraft()
    void navigate({ to: '/' })
  }

  useHotkey(
    keybinds.newThread.hotkey,
    (event) => {
      if (appShortcut(event)) newThread()
    },
    { requireReset: true, ignoreInputs: false }
  )

  // Read when a row acts, so a thread switch leaves the rows' callbacks, and so the rows, alone.
  const selectedRef = useRef(selectedId)
  useLayoutEffect(() => {
    selectedRef.current = selectedId
  })

  // Leaves a thread that's going away; the returned undo comes back to it if nothing else was opened.
  const leaveIfSelected = useCallback(
    (threadId: string) => {
      const selected = selectedRef.current
      if (!selected || !threadTreeIds(readChrome()?.threads ?? [], threadId).includes(selected))
        return () => {}
      void navigate({ to: '/' })
      return () => {
        if (router.state.location.pathname === '/')
          void navigate({ to: '/threads/$threadId', params: { threadId: selected } })
      }
    },
    [readChrome, navigate, router]
  )

  const confirmArchive = useCallback(
    (threadId: string) => {
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
    },
    [archiveThread, leaveIfSelected]
  )

  // The server refuses a worktree with uncommitted changes; check first so we never claim success.
  const archive = useCallback(
    (threadId: string) => {
      if (!hasWorktree(readChrome(), threadId)) {
        confirmArchive(threadId)
        return
      }
      checkChanges(threadId, (count) => {
        if (count > 0)
          toast.error(`Commit or discard ${uncommitted(count)} before archiving this worktree`)
        else confirmArchive(threadId)
      })
    },
    [readChrome, confirmArchive, checkChanges]
  )

  const confirmRemove = useCallback(
    (threadId: string) => {
      const comeBack = leaveIfSelected(threadId)
      const deletion = deleteThread(threadId)
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
    },
    [deleteThread, leaveIfSelected]
  )

  const remove = useCallback(
    (threadId: string) => {
      if (!hasWorktree(readChrome(), threadId)) {
        confirmRemove(threadId)
        return
      }
      checkChanges(threadId, (count) => {
        if (count > 0) setDeletePrompt({ threadId, count })
        else confirmRemove(threadId)
      })
    },
    [readChrome, confirmRemove, checkChanges]
  )

  return (
    <Sidebar
      data-perf-region='sidebar'
      aria-label='Thread sidebar'
      className='top-(--app-tab-bar-height) h-[calc(100svh-var(--app-tab-bar-height))] p-0 [timeline-scope:--sidebar-threads]'
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
                className={`${navigationButtonClass} keybind-target`}
                {...pressProps(newThread)}
              >
                <PencilEdit02Icon className='size-3' />
                New thread
                <HoverKeybind binding={keybinds.newThread} className='ml-auto' />
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
                onPointerEnter={refreshPullRequestLists}
                {...pressProps(() => {
                  refreshPullRequestLists()
                  void navigate({ to: '/pull-requests', search: pullRequestListSearch() })
                })}
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
        <MotionSidebarContent
          layoutScroll
          className='overscroll-contain px-1.5 pb-4 [scroll-timeline:--sidebar-threads_y]'
        >
          <nav aria-label='Threads'>
            <div className='flex flex-col [&>[data-thread-row]+[data-thread-row]]:mt-0.5'>
              {items.map((item) => {
                if (item.kind === 'heading') {
                  const heading = (
                    <>
                      {item.pinned && (
                        <PinIcon filled className='size-3 shrink-0' aria-hidden='true' />
                      )}
                      {item.archived && (
                        // Linear-style: the icon turns into the disclosure caret on hover or focus.
                        <span className='grid size-3 shrink-0 *:col-start-1 *:row-start-1'>
                          <Archive02Icon
                            className='size-3 group-hover/button:invisible group-focus-visible/button:invisible'
                            aria-hidden='true'
                          />
                          <ArrowRight01Icon
                            className='invisible size-3 group-hover/button:visible group-focus-visible/button:visible group-aria-expanded/button:rotate-90'
                            aria-hidden='true'
                          />
                        </span>
                      )}
                      {!item.pinned && !item.archived && grouping === 'project' && (
                        <ProjectGlyph icon={item.projectIcon} className='size-3' />
                      )}
                      {item.status && <StatusGlyph status={item.status} className='size-3' />}
                      <span className='flex min-w-0 flex-1 items-baseline gap-1'>
                        <span className='min-w-0 truncate font-medium'>{item.label}</span>
                        <span
                          className='ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums'
                          aria-label={`${item.count} thread${item.count === 1 ? '' : 's'}`}
                        >
                          {item.count}
                        </span>
                      </span>
                    </>
                  )
                  return item.archived ? (
                    <h3 key={item.id} className='mt-5 flex first:mt-0'>
                      <Button
                        variant='ghost-text'
                        className='h-auto w-full justify-start gap-1.5 rounded-sm border-0 px-2.5 py-1 text-xs font-normal aria-expanded:text-muted-foreground aria-expanded:not-disabled:hover:text-foreground'
                        aria-expanded={archivedOpen}
                        onClick={() => setArchivedOpen((open) => !open)}
                      >
                        {heading}
                      </Button>
                    </h3>
                  ) : (
                    <h3
                      key={item.id}
                      className='mt-5 flex items-center gap-1.5 px-2.5 py-1 text-xs font-normal text-muted-foreground first:mt-0'
                    >
                      {heading}
                    </h3>
                  )
                }
                return (
                  <motion.div
                    key={item.id}
                    data-thread-row
                    className={
                      item.archived && item.id !== selectedId
                        ? 'opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100'
                        : undefined
                    }
                    layout={reducedMotion ? false : 'position'}
                    layoutDependency={layoutDependency}
                    initial={false}
                    transition={{ layout: rowLayoutTransition }}
                    onPointerEnter={() => {
                      if (item.id !== selectedId) prefetch.enter(item.id)
                    }}
                    onPointerLeave={() => prefetch.leave(item.id)}
                  >
                    <SidebarThreadRow
                      id={item.id}
                      now={now}
                      shortcut={keybinds.threads[numbered.indexOf(item.id)]}
                      selected={selectedId === item.id}
                      onSelect={openThread}
                      onArchive={archive}
                      onUnarchive={archiveThread}
                      onDelete={remove}
                      onPin={pinThread}
                      onRename={renameThread}
                      onOpenPullRequest={openPullRequest}
                    />
                  </motion.div>
                )
              })}
              {groups && !groups.length && (
                <p className='px-2.5 py-4 text-sm text-muted-foreground'>No threads found.</p>
              )}
            </div>
          </nav>
        </MotionSidebarContent>
      </ThreadHoverGroup>
      <SidebarFooter className='sidebar-footer shrink-0 flex-row items-center gap-1 px-2.5 py-1.5'>
        <KeybindTooltip binding={keybinds.settings}>
          <Button
            variant='ghost'
            size='icon'
            className='hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground'
            aria-label='Settings'
            aria-current={onSettings ? 'page' : undefined}
            {...pressProps(() => void navigate({ to: '/settings' }))}
          >
            <KeybindIcon binding={keybinds.settings}>
              <Settings01Icon />
            </KeybindIcon>
          </Button>
        </KeybindTooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon'
                className='hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground'
                aria-label='Usage'
                aria-current={onUsage ? 'page' : undefined}
                onPointerEnter={prefetchUsage}
                {...pressProps(() => void navigate({ to: '/usage' }))}
              />
            }
          >
            <ChartHistogramIcon />
          </TooltipTrigger>
          <TooltipContent>Usage</TooltipContent>
        </Tooltip>
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
              {uncommitted(deletePrompt?.count ?? 0)} in this thread&apos;s worktree will be lost
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
})

function hasWorktree(chrome: Chrome | undefined, threadId: string) {
  const threads = chrome?.threads ?? []
  const tree = threadTreeIds(threads, threadId)
  return threads.some((thread) => tree.includes(thread.id) && thread.environment === 'worktree')
}

const SidebarThreadRow = memo(function SidebarThreadRow({
  id,
  now,
  shortcut,
  selected,
  onSelect,
  onArchive,
  onUnarchive,
  onDelete,
  onPin,
  onRename,
  onOpenPullRequest,
}: {
  id: string
  now: number
  shortcut?: Keybind
  selected: boolean
  onSelect: (id: string) => void
  onArchive: (id: string) => void
  onUnarchive: ReturnType<typeof useArchiveThread>
  onDelete: (id: string) => void
  onPin: ReturnType<typeof usePinThread>
  onRename: ReturnType<typeof useRenameThread>
  onOpenPullRequest: ReturnType<typeof useOpenPullRequest>
}) {
  const row = useSidebarRow(id)
  if (!row) return null
  const thread = sidebarThread(row, now)
  return (
    <ThreadRow
      {...thread}
      shortcut={shortcut}
      selected={selected}
      actions={{
        pinned: thread.pinned,
        archived: thread.archived,
        onArchive: () => (thread.archived ? onUnarchive(id, false) : onArchive(id)),
        onDelete: () => onDelete(id),
        onPin: () => onPin(id, !thread.pinned),
        pinKeybind: selected ? keybinds.pin : undefined,
        onRename: (title) => onRename(id, title),
      }}
      onSelect={() => onSelect(id)}
      onOpenPullRequest={() => thread.pullRequest && onOpenPullRequest(id, thread.pullRequest)}
    />
  )
})

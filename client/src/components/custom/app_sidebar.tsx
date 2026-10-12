import {
  ChevronRightSmallIcon,
  ArchiveIcon,
  EditSmall1Icon,
  PinIcon,
  PlusMediumIcon,
  PullRequestIcon,
} from '@/components/custom/central_icons'
import { CircleDotIcon } from '@/components/custom/lucide_icons'
import { pullRequestListSearch } from '@/components/custom/pull_request_list_model'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
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
  useBots,
} from '@/state'
import { threadTreeIds, useReadChrome, type Chrome } from '@/state/chrome'
import { botThreadsByBot, useSidebarList, useSidebarRow } from '@/state/sidebar'
import { useWorktreeChanges } from '@/state/worktrees'
import { useHotkey, useHotkeys } from '@tanstack/react-hotkeys'
import { useMatches, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { BotAvatar } from './bot_avatar'
import { BotRow } from './bot_row'
import { DisabledTooltip } from './disabled_tooltip'
import { HoverKeybind, keybinds, appShortcut, type Keybind } from './keybinds'
import { NewBotDialog } from './new_bot_dialog'
import { ProjectGlyph } from './project_glyph'
import { SidebarProfileMenu } from './sidebar_profile_menu'
import { SidebarThreadControls } from './sidebar_thread_controls'
import { sidebarGroups, sidebarThread, type ThreadGrouping } from './sidebar_thread_groups'
import { ThreadHoverGroup } from './thread_hover'
import { ThreadRow } from './thread_row'
import { StatusGlyph } from './thread_status'
import './app_sidebar.css'

const viewKey = 'jetty.sidebar.view'

function isBotIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string')
}

type SidebarView = {
  grouping: ThreadGrouping
  showPinned: boolean
  showArchived: boolean
}

function storedView(): SidebarView {
  let saved: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(storage.get(viewKey) ?? '{}')
    if (parsed && typeof parsed === 'object') saved = { ...parsed }
  } catch {}
  return {
    grouping:
      saved.grouping === 'project' || saved.grouping === 'status' || saved.grouping === 'bot'
        ? saved.grouping
        : 'date',
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
  const selectedBotId = useParams({ strict: false }).botId
  const bots = useBots()
  const [openBots, setOpenBots] = useStoredState('jetty.sidebar.bots.open', [], isBotIds)
  const [newBotOpen, setNewBotOpen] = useState(false)
  const pathname = useMatches({ select: (matches) => matches.at(-1)?.pathname ?? '/' })
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
  const openPullRequest = useOpenPullRequest()

  const list = useSidebarList()
  const mainList = list && {
    ...list,
    threads: query.trim() ? list.threads : list.threads.filter((thread) => !thread.botId),
  }
  const groups = mainList && sidebarGroups(mainList, { ...view, query }, now)
  const botThreads = botThreadsByBot(list?.threads ?? [])
  const nestedIds = new Set(
    bots.flatMap((bot) =>
      openBots.includes(bot.id) ? (botThreads.get(bot.id) ?? []).map((thread) => thread.id) : []
    )
  )
  // ⌥1–9 follow the visible rows, bots but not the threads nested under them, with search
  // duplicates sharing their thread's shortcut.
  const numbered = [
    ...bots.map((bot) => ({ kind: 'bot' as const, id: bot.id })),
    ...(groups ?? [])
      .flatMap((group) => (group.archived ? [] : group.threads))
      .filter((id) => !nestedIds.has(id))
      .map((id) => ({ kind: 'thread' as const, id })),
  ].slice(0, keybinds.sidebarRows.length)
  const shortcutFor = (kind: 'bot' | 'thread', id: string) =>
    keybinds.sidebarRows[numbered.findIndex((row) => row.kind === kind && row.id === id)]
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
    keybinds.sidebarRows.flatMap((binding, index) => {
      const row = numbered[index]
      return row
        ? [
            {
              hotkey: binding.hotkey,
              callback: (event: KeyboardEvent) => {
                // ⌥-digit glyphs stay available in every text field except the composer.
                if (!appShortcut(event)) return
                event.preventDefault()
                if (row.kind === 'bot')
                  void navigate({ to: '/bots/$botId', params: { botId: row.id } })
                else openThread(row.id)
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

  function toggleBot(botId: string) {
    setOpenBots((open) =>
      open.includes(botId) ? open.filter((id) => id !== botId) : [...open, botId]
    )
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
      <SidebarHeader className='shrink-0 px-1.5 pb-4 pt-2'>
        <nav aria-label='Main navigation'>
          <SidebarMenu className='gap-0.5'>
            <SidebarMenuItem>
              <Button
                variant='ghost'
                className={`${navigationButtonClass} keybind-target`}
                {...pressProps(newThread)}
              >
                <EditSmall1Icon className='size-3' />
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
                <PullRequestIcon className='size-3' />
                Pull requests
              </Button>
            </SidebarMenuItem>
          </SidebarMenu>
        </nav>
      </SidebarHeader>
      <ThreadHoverGroup>
        {/* Nested threads live here, so a bot with many of them scrolls instead of pushing the
            thread search, the list and the account footer off the sidebar. */}
        <section
          aria-label='Bots'
          className='no-scrollbar scroll-fade-y flex max-h-[70%] min-h-0 shrink flex-col gap-0.5 overflow-y-auto overscroll-contain px-1.5 pb-3.5'
        >
          {/* The plus lines up with the status glyphs below. */}
          <div className='flex h-6 items-center justify-between pr-1.5 pl-2.5'>
            <h2 className='text-xs font-medium text-muted-foreground'>Bots</h2>
            <div className='flex items-center gap-0.5'>
              <Button
                variant='ghost'
                size='icon-xs'
                aria-label='New bot'
                onClick={() => setNewBotOpen(true)}
              >
                <PlusMediumIcon />
              </Button>
            </div>
          </div>
          {bots.length ? (
            <div className='flex flex-col gap-0.5'>
              {bots.map((bot) => (
                <Collapsible key={bot.id} open={openBots.includes(bot.id)}>
                  <BotRow
                    bot={bot}
                    selected={bot.id === selectedBotId}
                    shortcut={shortcutFor('bot', bot.id)}
                    onOpen={() => void navigate({ to: '/bots/$botId', params: { botId: bot.id } })}
                    expanded={openBots.includes(bot.id)}
                    onToggle={() => toggleBot(bot.id)}
                  />
                  <CollapsibleContent>
                    <div className='flex flex-col gap-0.5 pt-0.5'>
                      {(botThreads.get(bot.id) ?? []).map(({ id }) => (
                        <div
                          key={id}
                          data-thread-row
                          onPointerEnter={() => {
                            if (id !== selectedId) prefetch.enter(id)
                          }}
                          onPointerLeave={() => prefetch.leave(id)}
                        >
                          <SidebarThreadRow
                            id={id}
                            now={now}
                            nested
                            shortcut={shortcutFor('thread', id)}
                            selected={selectedId === id}
                            onSelect={openThread}
                            onArchive={archive}
                            onUnarchive={archiveThread}
                            onDelete={remove}
                            onPin={pinThread}
                            onRename={renameThread}
                            onOpenPullRequest={openPullRequest}
                          />
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          ) : (
            <button
              type='button'
              onClick={() => setNewBotOpen(true)}
              className='flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
            >
              <span className='flex size-6 shrink-0 items-center justify-center'>
                <PlusMediumIcon />
              </span>
              Create a bot
            </button>
          )}
        </section>
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
        <MotionSidebarContent
          layoutScroll
          className='min-h-32 overscroll-contain px-1.5 pb-4 [scroll-timeline:--sidebar-threads_y]'
        >
          <nav aria-label='Threads'>
            <div className='flex flex-col [&>[data-thread-row]+[data-thread-row]]:mt-0.5'>
              {items.map((item) => {
                if (item.kind === 'heading') {
                  const ordinary = !item.pinned && !item.archived
                  const bot =
                    ordinary && grouping === 'bot'
                      ? bots.find((entry) => entry.id === item.botId)
                      : undefined
                  const heading = (
                    <>
                      {item.pinned && (
                        <PinIcon filled className='size-3 shrink-0' aria-hidden='true' />
                      )}
                      {item.archived && (
                        // Linear-style: the icon turns into the disclosure caret on hover or focus.
                        <span className='grid size-3 shrink-0 *:col-start-1 *:row-start-1'>
                          <ArchiveIcon
                            className='size-3 group-hover/button:invisible group-focus-visible/button:invisible'
                            aria-hidden='true'
                          />
                          <ChevronRightSmallIcon
                            className='invisible size-3 group-hover/button:visible group-focus-visible/button:visible group-aria-expanded/button:rotate-90'
                            aria-hidden='true'
                          />
                        </span>
                      )}
                      {ordinary && grouping === 'project' && (
                        <ProjectGlyph icon={item.projectIcon} className='size-3' />
                      )}
                      {item.status && <StatusGlyph status={item.status} className='size-3' />}
                      {bot && (
                        <BotAvatar
                          bot={bot}
                          size={12}
                          unread={false}
                          className='[--jb-ring:var(--sidebar)]'
                        />
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
                      shortcut={shortcutFor('thread', item.id)}
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
              {query.trim() && groups && !groups.length && (
                <p className='px-2.5 py-4 text-sm text-muted-foreground'>No threads found.</p>
              )}
            </div>
          </nav>
        </MotionSidebarContent>
      </ThreadHoverGroup>
      <SidebarFooter className='sidebar-footer shrink-0 px-1.5 py-1.5'>
        <SidebarProfileMenu rowClass={navigationButtonClass} />
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
      <NewBotDialog open={newBotOpen} onOpenChange={setNewBotOpen} />
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
  nested = false,
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
  // Bot threads, one line each; the main list keeps two.
  nested?: boolean
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
      botId={row.thread.botId}
      shortcut={shortcut}
      selected={selected}
      nested={nested}
      oneLine={nested}
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

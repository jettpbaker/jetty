import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadMeta } from '@jetty/shared/wire'

import { chromeStore, draftsStore, socket, tabsStore } from '@/app-state'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { loadLastProjectId, removeDraft } from '@/lib/draft'
import { pressHandlers } from '@/lib/press-handlers'
import { useStripDrag } from '@/lib/use-strip-drag'
import { cn } from '@/lib/utils'
import { useHotkeys } from '@tanstack/react-hotkeys'
import type { Draft } from '@/state/drafts'
import {
  BellRingingIcon,
  ExclamationMarkIcon,
  HouseIcon,
  MoonIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SpinnerIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState, useSyncExternalStore, type ReactElement } from 'react'

// One slot in the strip: separator zone (13) + pill (176).
const DRAG_STEP = 189

type StripEntry =
  | { kind: 'thread'; id: string; thread: ThreadMeta }
  | { kind: 'draft'; id: string; draft: Draft }

function StatusGlyph({ status }: { status: SessionStatus }) {
  switch (status) {
    case 'idle':
      return (
        <MoonIcon
          weight='fill'
          className='size-[18px] shrink-0 translate-y-px text-muted-foreground/60'
        />
      )
    case 'running':
    case 'starting':
      return <SpinnerIcon className='size-[18px] shrink-0 animate-spin text-muted-foreground' />
    case 'awaiting_approval':
      return <BellRingingIcon className='size-[18px] shrink-0 text-amber-400' />
    case 'error':
      return <ExclamationMarkIcon className='size-[18px] shrink-0 text-destructive' />
  }
}

function IconTip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const HOTKEY_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

export function TabBar() {
  const chrome = useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot)
  const tabIds = useSyncExternalStore(tabsStore.subscribe, tabsStore.getSnapshot)
  const drafts = useSyncExternalStore(draftsStore.subscribe, draftsStore.getSnapshot)
  const navigate = useNavigate()
  const { threadId: activeThreadId, draftId: activeDraftId } = useParams({ strict: false })
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const threadById = new Map(chrome.threads.map((thread) => [thread.id, thread]))
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]))

  const openEntries: StripEntry[] = []
  for (const id of tabIds) {
    const thread = threadById.get(id)
    if (thread && !thread.archived) {
      openEntries.push({ kind: 'thread', id, thread })
      continue
    }
    const draft = draftById.get(id)
    if (draft) openEntries.push({ kind: 'draft', id, draft })
  }

  const strip = useStripDrag({
    count: openEntries.length,
    step: DRAG_STEP,
    onReorder(from, to) {
      const fromEntry = openEntries[from]
      const toEntry = openEntries[to]
      if (fromEntry && toEntry) tabsStore.move(fromEntry.id, toEntry.id)
    },
  })

  // Chrome owns Cmd+num, so tab switching rides Ctrl+num (Ctrl+9 = last tab,
  // browser-style). Ctrl combos fire even while the composer has focus.
  useHotkeys([
    ...HOTKEY_DIGITS.map((digit) => ({
      hotkey: `Control+${digit}` as const,
      callback: () => {
        const entry = digit === 9 ? openEntries.at(-1) : openEntries[digit - 1]
        if (!entry) return
        if (entry.kind === 'thread') openThread(entry.id)
        else openDraft(entry.id)
      },
    })),
    { hotkey: 'Control+T', callback: newThread },
    {
      hotkey: 'Control+W',
      callback: () => {
        const activeId = activeThreadId ?? activeDraftId
        if (activeId) closeTab(activeId)
      },
    },
  ])

  function openThread(threadId: string) {
    tabsStore.open(threadId)
    void navigate({ to: '/thread/$threadId', params: { threadId } })
  }

  function openDraft(draftId: string) {
    void navigate({ to: '/new/$draftId', params: { draftId } })
  }

  function newThread() {
    // last-picked project if any; the draft page's picker takes it from here
    const draft = draftsStore.create(loadLastProjectId())
    tabsStore.open(draft.id)
    void navigate({ to: '/new/$draftId', params: { draftId: draft.id } })
  }

  function neighborOf(id: string): StripEntry | null {
    const index = openEntries.findIndex((entry) => entry.id === id)
    if (index === -1) return null
    // Prefer left; else right; else null → home.
    return openEntries[index - 1] ?? openEntries[index + 1] ?? null
  }

  function navigateEntry(entry: StripEntry | null) {
    if (entry?.kind === 'thread') {
      return navigate({ to: '/thread/$threadId', params: { threadId: entry.id } })
    }
    if (entry?.kind === 'draft') {
      return navigate({ to: '/new/$draftId', params: { draftId: entry.id } })
    }
    return navigate({ to: '/' })
  }

  function closeTab(id: string) {
    const entry = openEntries.find((row) => row.id === id)
    const wasActive = id === activeThreadId || id === activeDraftId
    const next = wasActive ? neighborOf(id) : null
    tabsStore.close(id)

    // Keep an active draft in the store until navigation commits — the draft
    // page redirects to / the moment its draft is missing (same as submit).
    const dropDraft = () => {
      if (entry?.kind !== 'draft') return
      draftsStore.remove(id)
      removeDraft(id)
    }

    if (!wasActive) {
      dropDraft()
      return
    }
    void navigateEntry(next).then(dropDraft)
  }

  function archiveTab(threadId: string) {
    closeTab(threadId)
    void socket.request('thread.archive', { threadId })
  }

  function touchesFocus(id: string | undefined) {
    return (
      id !== undefined &&
      (id === activeThreadId || id === activeDraftId || id === hoveredId)
    )
  }

  return (
    <div className='flex h-12 shrink-0 items-center gap-2 px-4'>
      <Link
        to='/'
        aria-label='Home'
        className='flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground'
      >
        <HouseIcon weight='fill' className='size-[18px] translate-y-px' />
      </Link>

      <div className='flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {openEntries.map((entry, index) => {
          const active = entry.id === activeThreadId || entry.id === activeDraftId
          const next = openEntries[index + 1]
          const dragging = strip.drag?.from === index
          const title = entry.kind === 'thread' ? entry.thread.title || entry.thread.id : 'New thread'
          const open = () => {
            if (entry.kind === 'thread') openThread(entry.id)
            else openDraft(entry.id)
          }

          return (
            <div key={entry.id} className='flex shrink-0 items-center'>
              <ContextMenu>
                <ContextMenuTrigger
                  className={cn(
                    'group relative flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
                    active
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50',
                    dragging && 'z-10 bg-accent text-foreground'
                  )}
                  style={dragging ? undefined : strip.shiftStyle(index)}
                  onPointerEnter={() => setHoveredId(entry.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  {...strip.handleProps(index)}
                >
                  <button
                    type='button'
                    aria-label={title}
                    className='absolute inset-0 rounded-md'
                    {...pressHandlers(open)}
                  />
                  <StatusGlyph status={entry.kind === 'thread' ? entry.thread.status : 'idle'} />
                  <span
                    className={cn(
                      'pointer-events-none relative min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left',
                      active
                        ? '[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
                        : '[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] group-hover:[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
                    )}
                  >
                    {title}
                  </span>
                  <button
                    type='button'
                    aria-label='Close tab'
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(entry.id)
                    }}
                    className={cn(
                      'absolute top-1/2 right-1.5 z-10 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground',
                      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}
                  >
                    <XIcon className='size-3.5' />
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => closeTab(entry.id)}>Close</ContextMenuItem>
                  {entry.kind === 'thread' && (
                    <ContextMenuItem onClick={() => archiveTab(entry.id)}>Archive</ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ContextMenu>
              <div className='flex w-[13px] shrink-0 items-center justify-center'>
                {next && (
                  <Separator
                    orientation='vertical'
                    className={cn(
                      'h-4! shrink-0 self-center! transition-opacity duration-150',
                      (touchesFocus(entry.id) || touchesFocus(next.id) || strip.drag !== null) &&
                        'opacity-0'
                    )}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <IconTip label='New thread'>
        <Button
          variant='ghost'
          size='icon'
          className='size-8 shrink-0'
          aria-label='New thread'
          {...pressHandlers(newThread)}
        >
          <PlusIcon />
        </Button>
      </IconTip>

      <div className='min-w-0 flex-1' />

      <IconTip label='Sidebar'>
        <Button variant='ghost' size='icon' aria-label='Toggle sidebar'>
          <SidebarSimpleIcon />
        </Button>
      </IconTip>
    </div>
  )
}

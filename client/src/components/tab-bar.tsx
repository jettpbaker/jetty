import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadMeta } from '@jetty/shared/wire'

import { chromeStore, socket, tabsStore } from '@/app-state'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pressHandlers } from '@/lib/press-handlers'
import { useStripDrag } from '@/lib/use-strip-drag'
import { cn } from '@/lib/utils'
import {
  BellRingingIcon,
  ExclamationMarkIcon,
  GearIcon,
  ListIcon,
  MoonIcon,
  PlusIcon,
  SpinnerIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState, useSyncExternalStore, type ReactElement } from 'react'

import { NewProjectDialog } from './new-project-dialog'
import { RansomWordmarkStatic } from './ransom-wordmark'

// One slot in the strip: separator zone (13) + pill (176).
const DRAG_STEP = 189

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

export function TabBar() {
  const chrome = useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot)
  const tabIds = useSyncExternalStore(tabsStore.subscribe, tabsStore.getSnapshot)
  const navigate = useNavigate()
  const { threadId: activeThreadId, projectId: draftProjectId } = useParams({ strict: false })
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const threadById = new Map(chrome.threads.map((thread) => [thread.id, thread]))
  const openTabs = tabIds
    .map((id) => threadById.get(id))
    .filter((thread): thread is ThreadMeta => thread !== undefined && !thread.archived)
  const openIds = openTabs.map((thread) => thread.id)
  const activeThread = activeThreadId ? threadById.get(activeThreadId) : undefined
  const newThreadProjectId =
    activeThread?.projectId ?? chrome.projects[0]?.id

  const strip = useStripDrag({
    count: openTabs.length,
    step: DRAG_STEP,
    onReorder(from, to) {
      const fromTab = openTabs[from]
      const toTab = openTabs[to]
      if (fromTab && toTab) tabsStore.move(fromTab.id, toTab.id)
    },
  })

  function openThread(threadId: string) {
    tabsStore.open(threadId)
    void navigate({ to: '/thread/$threadId', params: { threadId } })
  }

  function newThread(projectId: string) {
    void navigate({ to: '/new/$projectId', params: { projectId } })
  }

  function neighborOf(threadId: string): string | null {
    const index = openIds.indexOf(threadId)
    if (index === -1) return null
    return openIds[index + 1] ?? openIds[index - 1] ?? null
  }

  function closeTab(threadId: string) {
    const wasActive = threadId === activeThreadId
    const next = wasActive ? neighborOf(threadId) : null
    tabsStore.close(threadId)
    if (!wasActive) return
    if (next) {
      void navigate({ to: '/thread/$threadId', params: { threadId: next } })
    } else {
      void navigate({ to: '/' })
    }
  }

  function archiveTab(threadId: string) {
    closeTab(threadId)
    void socket.request('thread.archive', { threadId })
  }

  function touchesFocus(id: string | undefined) {
    return id !== undefined && (id === activeThreadId || id === hoveredId)
  }

  return (
    <div className='flex h-14 shrink-0 items-center gap-2 border-b px-3'>
      <Link to='/' aria-label='Jetty home' className='mr-1 shrink-0'>
        <RansomWordmarkStatic />
      </Link>

      <div className='flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {openTabs.map((thread, index) => {
          const active = thread.id === activeThreadId
          const prev = openTabs[index - 1]
          const dragging = strip.drag?.from === index
          return (
            <div key={thread.id} className='flex shrink-0 items-center'>
              <div className='flex w-[13px] shrink-0 items-center justify-center'>
                {index > 0 && (
                  <Separator
                    orientation='vertical'
                    className={cn(
                      'h-4! shrink-0 self-center! transition-opacity duration-150',
                      (touchesFocus(prev?.id) || touchesFocus(thread.id) || strip.drag !== null) &&
                        'opacity-0'
                    )}
                  />
                )}
              </div>
              <ContextMenu>
                <ContextMenuTrigger
                  className={cn(
                    'group relative flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
                    active
                      ? 'bg-[#2B2C2D] text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50',
                    dragging && 'z-10 bg-[#2B2C2D] text-foreground'
                  )}
                  style={dragging ? undefined : strip.shiftStyle(index)}
                  onPointerEnter={() => setHoveredId(thread.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  {...strip.handleProps(index)}
                >
                  <button
                    type='button'
                    aria-label={thread.title || thread.id}
                    className='absolute inset-0 rounded-md'
                    {...pressHandlers(() => openThread(thread.id))}
                  />
                  <StatusGlyph status={thread.status} />
                  <span
                    className={cn(
                      'pointer-events-none relative min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left',
                      active
                        ? '[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
                        : '[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] group-hover:[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
                    )}
                  >
                    {thread.title || thread.id}
                  </span>
                  <button
                    type='button'
                    aria-label='Close tab'
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(thread.id)
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
                  <ContextMenuItem onClick={() => closeTab(thread.id)}>Close</ContextMenuItem>
                  <ContextMenuItem onClick={() => archiveTab(thread.id)}>Archive</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
          )
        })}
        {draftProjectId !== undefined && (
          <div className='flex shrink-0 items-center'>
            {openTabs.length > 0 && (
              <div className='flex w-[13px] shrink-0 items-center justify-center'>
                <Separator
                  orientation='vertical'
                  className={cn(
                    'h-4! shrink-0 self-center! transition-opacity duration-150',
                    (touchesFocus(openTabs[openTabs.length - 1]?.id) ||
                      activeThreadId === undefined ||
                      strip.drag !== null) &&
                      'opacity-0'
                  )}
                />
              </div>
            )}
            <div className='flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md bg-[#2B2C2D] px-2.5 text-sm text-foreground'>
              <MoonIcon
                weight='fill'
                className='size-[18px] shrink-0 translate-y-px text-muted-foreground/60'
              />
              <span className='min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]'>
                New thread
              </span>
            </div>
          </div>
        )}
      </div>

      <IconTip label='New thread'>
        <Button
          variant='ghost'
          size='icon'
          className='size-8 shrink-0'
          aria-label='New thread'
          disabled={newThreadProjectId === undefined}
          {...(newThreadProjectId
            ? pressHandlers(() => newThread(newThreadProjectId))
            : {})}
        >
          <PlusIcon />
        </Button>
      </IconTip>

      <div className='min-w-0 flex-1' />

      <div className='flex shrink-0 items-center gap-1'>
        <DropdownMenu>
          <IconTip label='All threads'>
            <DropdownMenuTrigger
              render={
                <Button variant='ghost' size='icon' aria-label='All threads'>
                  <ListIcon />
                </Button>
              }
            />
          </IconTip>
          <DropdownMenuContent align='end' className='max-h-96 w-64'>
            {chrome.projects.map((project) => {
              const threads = chrome.threads.filter(
                (thread) => thread.projectId === project.id && !thread.archived
              )
              if (threads.length === 0) return null
              return (
                <DropdownMenuGroup key={project.id}>
                  <DropdownMenuLabel className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
                    {project.title}
                  </DropdownMenuLabel>
                  {threads.map((thread) => (
                    <DropdownMenuItem key={thread.id} onClick={() => openThread(thread.id)}>
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          statusDotClass(thread.status)
                        )}
                      />
                      <span className='truncate'>{thread.title || thread.id}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
              New project…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <IconTip label='Settings'>
          <Button
            variant='ghost'
            size='icon'
            nativeButton={false}
            render={
              <Link to='/settings' aria-label='Settings'>
                <GearIcon />
              </Link>
            }
          />
        </IconTip>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        showTrigger={false}
      />
    </div>
  )
}

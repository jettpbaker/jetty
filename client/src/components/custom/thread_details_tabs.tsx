import type { PullRequestLink } from '@jetty/shared/wire'

import {
  BubbleChatIcon,
  File01Icon,
  LeftToRightListBulletIcon,
  Link01Icon,
  PlusSignIcon,
  Cancel01Icon,
} from '@/components/custom/huge_icons'
import { DiffIcon, WorkflowIcon } from '@/components/custom/lucide_icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { storage } from '@/platform'
import { pullRequestTabId, type PullRequestRef } from '@/state'
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { RestrictToElement } from '@dnd-kit/dom/modifiers'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { useReducedMotion } from 'motion/react'
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react'

import { DisabledTooltip } from './disabled_tooltip'
import { FilePicker } from './file_picker'
import { KeybindChip, keybinds } from './keybinds'
import { LinkPullRequestDialog } from './pull_request_link'
import { linkPresentation } from './thread_pull_request'

const tabs = {
  chat: { label: 'Chat', Icon: BubbleChatIcon },
  overview: { label: 'Overview', Icon: LeftToRightListBulletIcon },
  changes: { label: 'Changes', Icon: DiffIcon },
  threads: { label: 'Threads', Icon: WorkflowIcon },
}
type TabId = keyof typeof tabs
// Selects a tab, reopening it first if the user had closed it.
export type DetailsTabsHandle = { show: (id: TabId) => void }
const sortableIds: TabId[] = ['overview', 'changes', 'threads']
const storageKey = 'jetty.details-tabs'
const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
]
const modifiers = [
  RestrictToElement.configure({
    element: (operation) => operation.source?.element?.closest('[role="tablist"]') ?? null,
  }),
]

function loadState(): { order: TabId[]; closed: TabId[] } {
  try {
    const saved: unknown = JSON.parse(storage.get(storageKey) ?? 'null')
    if (
      saved &&
      typeof saved === 'object' &&
      Array.isArray((saved as { order?: unknown }).order) &&
      Array.isArray((saved as { closed?: unknown }).closed)
    ) {
      const { order, closed } = saved as { order: unknown[]; closed: unknown[] }
      const known = order.filter((id): id is TabId => sortableIds.includes(id as TabId))
      return {
        order: [...new Set([...known, ...sortableIds])],
        closed: closed.filter((id): id is TabId => typeof id === 'string' && id in tabs),
      }
    }
  } catch {
    // A corrupt saved order falls back to the default.
  }
  return { order: sortableIds, closed: [] }
}

export type PullRequestTabs = {
  links: readonly PullRequestLink[]
  visible: readonly PullRequestLink[]
  show: (ref: PullRequestRef) => void
  hide: (ref: PullRequestRef) => void
}

export function ThreadDetailsTabs({
  ref,
  chat = false,
  threadId,
  threadCount,
  pullRequests,
  file,
  filePicker,
  value,
  onValueChange,
  changesDisabled,
}: {
  ref?: Ref<DetailsTabsHandle>
  chat?: boolean
  threadId: string
  threadCount: number
  pullRequests: PullRequestTabs
  file?: { path: string; dirty: boolean; onClose: () => void }
  // Finding a project file to open in the file tab, from this bar's + menu or ⌘P.
  filePicker?: {
    projectId: string
    threadId: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onPick: (path: string) => void
  }
  value: string
  onValueChange: (value: string) => void
  changesDisabled?: string
}) {
  const [{ order, closed }, setState] = useState(loadState)
  const [announcement, setAnnouncement] = useState('')
  const [linking, setLinking] = useState(false)
  const plus = useRef<HTMLButtonElement>(null)
  const closedSet = new Set(closed)
  const chatOpen = chat && !closedSet.has('chat')
  const available = order.filter((id) => id !== 'threads' || threadCount > 0)
  const openSortable = available.filter((id) => !closedSet.has(id))
  const shownSortable =
    openSortable.length > 0 || chatOpen || pullRequests.visible.length > 0 || file
      ? openSortable
      : [available[0]!]
  const catalog = [...(chat ? ['chat' as const] : []), ...available]
  const visible: string[] = [
    ...(chatOpen ? ['chat' as const] : []),
    ...shownSortable,
    ...pullRequests.visible.map(pullRequestTabId),
    ...(file ? ['file'] : []),
  ]
  const fileName = file?.path.split('/').at(-1)
  const valueVisible = visible.includes(value)
  const first = visible[0]!
  const fallback = available[0]!
  const reopenFirst = shownSortable !== openSortable
  useEffect(() => {
    storage.set(storageKey, JSON.stringify({ order, closed }))
  }, [order, closed])
  useLayoutEffect(() => {
    if (reopenFirst)
      setState((state) => ({
        ...state,
        closed: state.closed.filter((id) => id !== fallback),
      }))
  }, [reopenFirst, fallback])
  useLayoutEffect(() => {
    if (!valueVisible) onValueChange(first)
  }, [valueVisible, first, onValueChange])
  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= openSortable.length) return
    const nextVisible = [...openSortable]
    const [id] = nextVisible.splice(from, 1)
    nextVisible.splice(to, 0, id!)
    let index = 0
    const next = order.map((tab) => (openSortable.includes(tab) ? nextVisible[index++]! : tab))
    setState((state) => ({ ...state, order: next }))
    setAnnouncement(`${tabs[id!].label} moved to position ${to + 1} of ${nextVisible.length}`)
  }
  function leave(id: string) {
    const remaining = visible.filter((tab) => tab !== id)
    if (value === id) onValueChange(remaining[0]!)
  }
  function closeTab(id: TabId) {
    if (visible.length < 2) return
    setState((state) => ({
      ...state,
      closed: state.closed.includes(id) ? state.closed : [...state.closed, id],
    }))
    setAnnouncement(`${tabs[id].label} closed`)
    leave(id)
  }
  function openTab(id: TabId) {
    setState((state) => ({ ...state, closed: state.closed.filter((tab) => tab !== id) }))
    setAnnouncement(`${tabs[id].label} opened`)
    onValueChange(id)
  }
  useImperativeHandle(ref, () => ({ show: openTab }))
  function closeFile() {
    if (!file || visible.length < 2) return
    file.onClose()
    setAnnouncement(`${fileName} closed`)
    leave('file')
  }
  function closePullRequest(link: PullRequestLink) {
    if (visible.length < 2) return
    pullRequests.hide(link)
    setAnnouncement(`Pull request #${link.number} closed`)
    leave(pullRequestTabId(link))
  }
  function openPullRequest(link: PullRequestLink) {
    pullRequests.show(link)
    setAnnouncement(`Pull request #${link.number} opened`)
    onValueChange(pullRequestTabId(link))
  }
  const canClose = visible.length > 1
  return (
    <DragDropProvider
      sensors={sensors}
      modifiers={modifiers}
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source } = event.operation
        if (isSortable(source)) reorder(source.initialIndex, source.index)
      }}
    >
      <TabsList
        activateOnFocus={false}
        variant='line'
        aria-label='Thread details views'
        className='h-full! gap-1.5 p-1 px-2'
      >
        {chatOpen && (
          <TabsTrigger
            value='chat'
            className='details-header-tab h-auto rounded-sm px-1 py-1 text-xs'
          >
            <StaticTabLabel id='chat' canClose={canClose} onClose={closeTab} />
          </TabsTrigger>
        )}
        {shownSortable.map((id, index) => (
          <SortableTab
            key={id}
            id={id}
            index={index}
            count={id === 'threads' ? threadCount : undefined}
            disabledReason={id === 'changes' ? changesDisabled : undefined}
            canClose={canClose}
            onMove={reorder}
            onClose={closeTab}
          />
        ))}
        {pullRequests.visible.map((link) => {
          const pr = linkPresentation(link)
          return (
            <TabsTrigger
              key={pullRequestTabId(link)}
              value={pullRequestTabId(link)}
              className='details-header-tab h-auto rounded-sm px-1 py-1 text-xs'
              title={
                link.title ? `${link.title} · ${link.repo}#${link.number} · ${pr.label}` : link.url
              }
            >
              <TabLabel
                label={`#${link.number}`}
                mono
                icon={<pr.icon className={cn('details-tab-kind size-3', pr.color)} />}
                canClose={canClose}
                onClose={() => closePullRequest(link)}
              />
            </TabsTrigger>
          )
        })}
        {file && (
          <TabsTrigger
            value='file'
            className='details-header-tab h-auto rounded-sm px-1 py-1 text-xs'
            title={file.dirty ? `${file.path} · Unsaved changes` : file.path}
          >
            <TabLabel
              label={fileName!}
              mono
              icon={<File01Icon className='details-tab-kind size-3' />}
              canClose={canClose}
              onClose={closeFile}
            />
            {file.dirty && (
              <>
                <span aria-hidden='true' className='size-1.5 shrink-0 rounded-full bg-current' />
                <span className='sr-only'>Unsaved changes</span>
              </>
            )}
          </TabsTrigger>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button ref={plus} variant='ghost' size='icon-sm' className='shrink-0 rounded-sm' />
            }
            aria-label='Open tab'
          >
            <PlusSignIcon className='size-3' />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='start'
            className={cn('min-w-36', pullRequests.links.length > 0 && 'w-72')}
          >
            {catalog.map((id) => {
              const { label, Icon } = tabs[id]
              const open = visible.includes(id)
              return (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={open}
                  disabled={open && !canClose}
                  closeOnClick={false}
                  onCheckedChange={(checked) => (checked ? openTab(id) : closeTab(id))}
                >
                  <Icon />
                  {label}
                </DropdownMenuCheckboxItem>
              )
            })}
            {filePicker && (
              <DropdownMenuItem onClick={() => filePicker.onOpenChange(true)}>
                <File01Icon />
                Open file…
                <KeybindChip binding={keybinds.openFile} className='ml-auto' />
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {pullRequests.links.map((link) => {
              const pr = linkPresentation(link)
              const open = pullRequests.visible.includes(link)
              return (
                <DropdownMenuCheckboxItem
                  key={pullRequestTabId(link)}
                  checked={open}
                  disabled={open && !canClose}
                  closeOnClick={false}
                  onCheckedChange={(checked) =>
                    checked ? openPullRequest(link) : closePullRequest(link)
                  }
                >
                  <pr.icon className={pr.color} />
                  <span className='font-mono text-muted-foreground'>#{link.number}</span>
                  <span className='truncate'>{link.title}</span>
                </DropdownMenuCheckboxItem>
              )
            })}
            <DropdownMenuItem onClick={() => setLinking(true)}>
              <Link01Icon />
              Link pull request
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TabsList>
      <output className='sr-only'>{announcement}</output>
      <LinkPullRequestDialog threadId={threadId} open={linking} onOpenChange={setLinking} />
      {filePicker && <FilePicker anchor={plus} {...filePicker} />}
    </DragDropProvider>
  )
}

function SortableTab({
  id,
  index,
  count,
  disabledReason,
  canClose,
  onMove,
  onClose,
}: {
  id: TabId
  index: number
  count?: number
  disabledReason?: string
  canClose: boolean
  onMove: (from: number, to: number) => void
  onClose: (id: TabId) => void
}) {
  const reducedMotion = useReducedMotion()
  const { ref } = useSortable({
    id,
    index,
    transition: reducedMotion ? null : { duration: 150, easing: 'ease-out' },
  })
  return (
    <DisabledTooltip reason={disabledReason} wrap='inline-flex'>
      <TabsTrigger
        ref={ref}
        value={id}
        disabled={Boolean(disabledReason)}
        // dnd-kit overwrites aria-disabled on sortables, so the disabled style keys off data-disabled.
        className='details-header-tab h-auto touch-none rounded-sm px-1 py-1 text-xs data-disabled:cursor-not-allowed data-disabled:text-disabled-foreground data-disabled:[&_svg]:text-disabled-foreground'
        title='Drag to reorder · Option+Shift+←/→'
        aria-keyshortcuts='Alt+Shift+ArrowLeft Alt+Shift+ArrowRight'
        onKeyDown={(event) => {
          if (!event.altKey || !event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key))
            return
          event.preventDefault()
          event.stopPropagation()
          onMove(index, index + (event.key === 'ArrowLeft' ? -1 : 1))
        }}
      >
        <StaticTabLabel id={id} count={count} canClose={canClose} onClose={onClose} />
      </TabsTrigger>
    </DisabledTooltip>
  )
}

function StaticTabLabel({
  id,
  count,
  canClose,
  onClose,
}: {
  id: TabId
  count?: number
  canClose: boolean
  onClose: (id: TabId) => void
}) {
  const { label, Icon } = tabs[id]
  return (
    <TabLabel
      label={label}
      icon={<Icon className='details-tab-kind size-3' />}
      count={count}
      canClose={canClose}
      onClose={() => onClose(id)}
    />
  )
}

function TabLabel({
  label,
  mono = false,
  icon,
  count,
  canClose,
  onClose,
}: {
  label: string
  mono?: boolean
  icon: ReactNode
  count?: number
  canClose: boolean
  onClose: () => void
}) {
  function stop(event: PointerEvent | MouseEvent | KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <>
      <span className='details-tab-icon'>
        {icon}
        {canClose && (
          <span
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a <button> can't nest inside the tab's <button>
            role='button'
            tabIndex={0}
            aria-label={`Close ${label}`}
            className='details-tab-close'
            onPointerDown={stop}
            onClick={(event) => {
              stop(event)
              onClose()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              stop(event)
              onClose()
            }}
          >
            <Cancel01Icon className='size-3' />
          </span>
        )}
      </span>
      {mono ? <span className='font-mono'>{label}</span> : label}
      {count !== undefined && <span className='font-mono text-muted-foreground'>{count}</span>}
    </>
  )
}

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { storage } from '@/platform'
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { RestrictToElement } from '@dnd-kit/dom/modifiers'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { CommentDiscussionIcon, DiffIcon, PlusIcon, XIcon } from '@primer/octicons-react'
import { useReducedMotion } from 'motion/react'
import {
  useEffect,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'

const tabs = {
  chat: { label: 'Chat', Icon: CommentDiscussionIcon },
  changes: { label: 'Changes', Icon: DiffIcon },
}
type TabId = keyof typeof tabs
const sortableIds: TabId[] = ['changes']
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
      if (order.length === sortableIds.length && sortableIds.every((id) => order.includes(id))) {
        return {
          order: order as TabId[],
          closed: closed.filter((id): id is TabId => typeof id === 'string' && id in tabs),
        }
      }
    }
  } catch {
    // A corrupt saved order falls back to the default.
  }
  return { order: sortableIds, closed: [] }
}

export function ThreadDetailsTabs({
  chat = false,
  value,
  onValueChange,
}: {
  chat?: boolean
  value: string
  onValueChange: (value: string) => void
}) {
  const [{ order, closed }, setState] = useState(loadState)
  const [announcement, setAnnouncement] = useState('')
  const closedSet = new Set(closed)
  const chatOpen = chat && !closedSet.has('chat')
  const openSortable = order.filter((id) => !closedSet.has(id))
  const shownSortable = openSortable.length > 0 || chatOpen ? openSortable : [order[0]!]
  const catalog = [...(chat ? ['chat' as const] : []), ...order]
  const visible = [...(chatOpen ? ['chat' as const] : []), ...shownSortable]
  const valueVisible = visible.includes(value as TabId)
  const first = visible[0]!
  const reopenFirst = shownSortable !== openSortable
  useEffect(() => {
    storage.set(storageKey, JSON.stringify({ order, closed }))
  }, [order, closed])
  useLayoutEffect(() => {
    if (reopenFirst)
      setState((state) => ({
        ...state,
        closed: state.closed.filter((id) => id !== state.order[0]),
      }))
  }, [reopenFirst])
  useLayoutEffect(() => {
    if (!valueVisible) onValueChange(first)
  }, [valueVisible, first, onValueChange])
  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= openSortable.length) return
    const nextVisible = [...openSortable]
    const [id] = nextVisible.splice(from, 1)
    nextVisible.splice(to, 0, id!)
    let index = 0
    const next = order.map((tab) => (closedSet.has(tab) ? tab : nextVisible[index++]!))
    setState((state) => ({ ...state, order: next }))
    setAnnouncement(`${tabs[id!].label} moved to position ${to + 1} of ${nextVisible.length}`)
  }
  function closeTab(id: TabId) {
    if (visible.length < 2) return
    const remaining = visible.filter((tab) => tab !== id)
    setState((state) => ({
      ...state,
      closed: state.closed.includes(id) ? state.closed : [...state.closed, id],
    }))
    setAnnouncement(`${tabs[id].label} closed`)
    if (value === id) onValueChange(remaining[0]!)
  }
  function openTab(id: TabId) {
    setState((state) => ({ ...state, closed: state.closed.filter((tab) => tab !== id) }))
    setAnnouncement(`${tabs[id].label} opened`)
    onValueChange(id)
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
            <TabLabel id='chat' canClose={canClose} onClose={closeTab} />
          </TabsTrigger>
        )}
        {shownSortable.map((id, index) => (
          <SortableTab
            key={id}
            id={id}
            index={index}
            canClose={canClose}
            onMove={reorder}
            onClose={closeTab}
          />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant='ghost' tone='muted' size='icon-sm' className='shrink-0 rounded-sm' />
            }
            aria-label='Open tab'
          >
            <PlusIcon className='size-3' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='min-w-36'>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </TabsList>
      <output className='sr-only'>{announcement}</output>
    </DragDropProvider>
  )
}

function SortableTab({
  id,
  index,
  canClose,
  onMove,
  onClose,
}: {
  id: TabId
  index: number
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
    <TabsTrigger
      ref={ref}
      value={id}
      className='details-header-tab h-auto touch-none rounded-sm px-1 py-1 text-xs'
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
      <TabLabel id={id} canClose={canClose} onClose={onClose} />
    </TabsTrigger>
  )
}

function TabLabel({
  id,
  canClose,
  onClose,
}: {
  id: TabId
  canClose: boolean
  onClose: (id: TabId) => void
}) {
  const { label, Icon } = tabs[id]
  function stop(event: PointerEvent | MouseEvent | KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <>
      <span className='details-tab-icon'>
        <Icon className='details-tab-kind size-3' />
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
              onClose(id)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              stop(event)
              onClose(id)
            }}
          >
            <XIcon className='size-3' />
          </span>
        )}
      </span>
      {label}
    </>
  )
}

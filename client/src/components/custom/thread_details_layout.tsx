import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { pressProps } from '@/lib/press'
import { ArrowsInSimpleIcon, ArrowsOutSimpleIcon, SidebarSimpleIcon } from '@phosphor-icons/react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { ChildThreadList, useChildThreads } from './child_threads'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { ThreadChanges } from './thread_changes'
import { ThreadDetailsTabs } from './thread_details_tabs'
import './thread_details_layout.css'

const minWidth = 320
const narrowWidth = 760

export function ThreadDetailsLayout({
  threadId,
  children,
}: {
  threadId: string
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number; next: number } | null>(null)
  const chatHost = useRef<HTMLDivElement>(null)
  if (!chatHost.current) {
    chatHost.current = document.createElement('div')
    chatHost.current.className = 'flex h-full min-h-0 min-w-0 flex-col'
  }
  const [leftSlot, setLeftSlot] = useState<HTMLDivElement | null>(null)
  const [chatSlot, setChatSlot] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [available, setAvailable] = useState(0)
  const [preferredWidth, setPreferredWidth] = useState<number>()
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('changes')
  const allChildThreads = useChildThreads(threadId)
  const childThreads = useMemo(
    () => allChildThreads.filter((child) => !child.archived),
    [allChildThreads]
  )
  const narrow = available < narrowWidth
  const full = narrow || expanded
  const max = Math.max(minWidth, available - 360)
  const clamp = (width: number) => Math.max(minWidth, Math.min(max, width))
  const width = full ? available : clamp(preferredWidth ?? available * 0.5)

  function toggle() {
    if (root.current) setAvailable(root.current.clientWidth)
    setOpen((value) => !value)
  }

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.code !== 'KeyB' ||
        !event.metaKey ||
        !event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      )
        return
      event.preventDefault()
      toggle()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let previous = 0
    const observer = new ResizeObserver(([entry]) => {
      const next = entry!.contentRect.width
      if (next <= 0) return
      // A closed panel only cares about crossing the narrow breakpoint.
      if (open || previous === 0 || previous < narrowWidth !== next < narrowWidth)
        setAvailable(next)
      previous = next
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [open])

  const portalTarget = open && full ? chatSlot : leftSlot
  // Keep the portal container stable: changing it remounts the entire chat,
  // including markdown, tool disclosures, and the composer.
  useLayoutEffect(() => {
    if (portalTarget && chatHost.current) portalTarget.appendChild(chatHost.current)
  }, [portalTarget])

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width, next: width }
    if (root.current) root.current.dataset.resizing = 'true'
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !root.current) return
    const next = clamp(drag.current.width + drag.current.x - event.clientX)
    drag.current.next = next
    root.current.style.setProperty('--details-width', `${next}px`)
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(next)))
  }

  function finish() {
    if (!drag.current) return
    setPreferredWidth(drag.current.next)
    drag.current = null
    if (root.current) delete root.current.dataset.resizing
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = { ArrowLeft: width + 16, ArrowRight: width - 16, Home: minWidth, End: max }[
      event.key
    ]
    if (next === undefined) return
    event.preventDefault()
    setPreferredWidth(clamp(next))
  }

  // Width changes should only update the layout, not rerender tab contents.
  const detailsPane = useMemo(
    () => (
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (typeof value === 'string') setTab(value)
        }}
        className='details-pane h-full min-w-0 gap-0'
      >
        <header className='flex h-(--app-tab-bar-height) shrink-0 border-b border-border pr-[74px]'>
          {full && (
            <div className='flex shrink-0 items-center pl-(--page-header-inset)'>
              <PageSidebarTrigger />
            </div>
          )}
          <div className='min-w-0 flex-1 overflow-hidden'>
            <ThreadDetailsTabs
              chat={full}
              threadCount={childThreads.length}
              value={tab}
              onValueChange={setTab}
            />
          </div>
        </header>
        <div className='min-h-0 flex-1 overflow-hidden'>
          <div className='details-tab-track'>
            <TabsContent
              keepMounted
              value='chat'
              inert={tab !== 'chat'}
              aria-hidden={tab !== 'chat'}
              className='details-tab-panel'
            >
              <div ref={setChatSlot} className='flex h-full min-h-0 min-w-0 flex-col' />
            </TabsContent>
            <TabsContent
              keepMounted
              value='changes'
              inert={tab !== 'changes'}
              aria-hidden={tab !== 'changes'}
              className='details-tab-panel'
            >
              {open && <ThreadChanges key={threadId} threadId={threadId} />}
            </TabsContent>
            <TabsContent
              keepMounted
              value='threads'
              inert={tab !== 'threads'}
              aria-hidden={tab !== 'threads'}
              className='details-tab-panel'
            >
              <div className='scrollbar-subtle h-full overflow-auto'>
                <ChildThreadList threads={childThreads} />
              </div>
            </TabsContent>
          </div>
        </div>
      </Tabs>
    ),
    [tab, full, open, threadId, childThreads]
  )

  return (
    <div
      ref={root}
      data-details-open={open}
      data-details-full={full || undefined}
      className='thread-details-layout'
      style={{ '--details-width': `${open ? width : 0}px` } as CSSProperties}
    >
      <div
        className='min-h-0 min-w-0 overflow-hidden'
        inert={open && full}
        aria-hidden={(open && full) || undefined}
      >
        <div ref={setLeftSlot} className='flex h-full min-w-[320px] flex-col' />
      </div>
      {createPortal(children, chatHost.current)}
      <aside
        aria-label='Thread details'
        inert={!open}
        aria-hidden={!open || undefined}
        className='relative min-h-0 min-w-0 overflow-hidden bg-background'
      >
        {detailsPane}
      </aside>
      <div className='absolute top-0 right-2.5 z-20 flex h-[calc(var(--app-tab-bar-height)-1px)] items-center gap-1'>
        {open && !narrow && (
          <Button
            variant='ghost-text'
            size='icon'
            aria-label={expanded ? 'Restore split view' : 'Expand thread details'}
            title={expanded ? 'Restore split view' : 'Expand thread details'}
            {...pressProps(() => setExpanded((value) => !value))}
          >
            {expanded ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
          </Button>
        )}
        <Button
          variant='ghost-text'
          size='icon'
          className='aria-expanded:text-muted-foreground aria-expanded:enabled:hover:text-foreground'
          aria-label={open ? 'Close thread details' : 'Open thread details'}
          aria-expanded={open}
          aria-keyshortcuts='Meta+Alt+B'
          title='Toggle thread details (⌘⌥B)'
          {...pressProps(toggle)}
        >
          <SidebarSimpleIcon className='rotate-180' />
        </Button>
      </div>
      {open && !full && (
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a focusable splitter; <hr> can't take focus or pointer handlers
          role='separator'
          aria-label='Resize thread details'
          aria-orientation='vertical'
          aria-valuemin={minWidth}
          aria-valuemax={Math.round(max)}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          className='thread-details-resize'
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onKeyDown={keyDown}
        />
      )}
    </div>
  )
}

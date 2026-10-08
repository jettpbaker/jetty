import {
  ArrowExpand01Icon,
  ArrowShrink02Icon,
  SidebarLeftIcon,
} from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { pressProps } from '@/lib/press'
import { useHotkey } from '@tanstack/react-hotkeys'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { inDialog, KeybindTooltip, keybinds } from './keybinds'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import './details_layout.css'

const minWidth = 320
const narrowWidth = 760

export type DetailsLayoutState = ReturnType<typeof useDetailsLayout>

// A details pane beside a chat (a thread's or a bot's): whether it's open, how wide, and where
// the chat sits. Narrow or expanded, the pane takes the whole width and the chat moves into its
// Chat tab.
export function useDetailsLayout() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [chatHost] = useState(() => {
    const host = document.createElement('div')
    host.className = 'flex h-full min-h-0 min-w-0 flex-col'
    return host
  })
  const [leftSlot, setLeftSlot] = useState<HTMLDivElement | null>(null)
  // The chat starts here, attached before its own layout effects run (they run before the
  // layout's), so on its first commit it measures a connected scroller, not a detached one.
  const attachLeftSlot = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot && !chatHost.parentNode) slot.appendChild(chatHost)
      setLeftSlot(slot)
    },
    [chatHost]
  )
  const [chatSlot, setChatSlot] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  // The pane paints at the click and its heavy tabs mount a frame later, so a slow diff never holds it back.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!open) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setReady(true))
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      setReady(false)
    }
  }, [open])
  const [available, setAvailable] = useState(0)
  const [preferredWidth, setPreferredWidth] = useState<number>()
  const [expanded, setExpanded] = useState(false)
  const narrow = available < narrowWidth
  const full = narrow || expanded
  const max = Math.max(minWidth, available - 360)
  const clamp = (width: number) => Math.max(minWidth, Math.min(max, width))
  const width = full ? available : clamp(preferredWidth ?? available * 0.5)

  // Opening measures first, so the pane's first frame already has its width.
  const show = useCallback(() => {
    if (rootRef.current) setAvailable(rootRef.current.clientWidth)
    setOpen(true)
  }, [])
  const toggle = useCallback(() => {
    if (rootRef.current) setAvailable(rootRef.current.clientWidth)
    setOpen((value) => !value)
  }, [])

  useHotkey(
    keybinds.details.hotkey,
    (event) => {
      if (!inDialog(event)) toggle()
    },
    { requireReset: true, ignoreInputs: false }
  )

  useLayoutEffect(() => {
    const element = rootRef.current
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
    if (portalTarget && chatHost.parentNode !== portalTarget) portalTarget.appendChild(chatHost)
  }, [portalTarget, chatHost])

  return {
    rootRef,
    chatHost,
    attachLeftSlot,
    setChatSlot,
    open,
    ready,
    narrow,
    full,
    expanded,
    setExpanded,
    width,
    max,
    clamp,
    setPreferredWidth,
    show,
    toggle,
  }
}

// The chat, the pane beside it, the toggle and the resize handle. `label` names the pane
// ("Thread details").
export function DetailsLayout({
  layout,
  label,
  pane,
  children,
}: {
  layout: DetailsLayoutState
  label: string
  pane: ReactNode
  children: ReactNode
}) {
  const { rootRef, chatHost, attachLeftSlot, open, full, width, max, clamp, toggle } = layout
  const dragRef = useRef<{ x: number; width: number; next: number } | null>(null)
  const name = label.toLowerCase()

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, width, next: width }
    if (rootRef.current) rootRef.current.dataset.resizing = 'true'
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const root = rootRef.current
    if (!drag || !root) return
    const next = clamp(drag.width + drag.x - event.clientX)
    drag.next = next
    root.style.setProperty('--details-width', `${next}px`)
    root.style.setProperty('--details-pane-width', `${next}px`)
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(next)))
  }

  function finish() {
    if (!dragRef.current) return
    layout.setPreferredWidth(dragRef.current.next)
    dragRef.current = null
    if (rootRef.current) delete rootRef.current.dataset.resizing
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = { ArrowLeft: width + 16, ArrowRight: width - 16, Home: minWidth, End: max }[
      event.key
    ]
    if (next === undefined) return
    event.preventDefault()
    layout.setPreferredWidth(clamp(next))
  }

  return (
    <div
      ref={rootRef}
      data-details-open={open}
      data-details-full={full || undefined}
      className='details-layout'
      style={
        {
          '--details-width': `${open ? width : 0}px`,
          '--details-pane-width': `${width}px`,
        } as CSSProperties
      }
    >
      <div
        className='min-h-0 min-w-0 overflow-hidden'
        inert={open && full}
        aria-hidden={(open && full) || undefined}
      >
        <div ref={attachLeftSlot} className='flex h-full min-w-[320px] flex-col' />
      </div>
      {createPortal(children, chatHost)}
      <aside
        aria-label={label}
        inert={!open}
        aria-hidden={!open || undefined}
        className='relative min-h-0 min-w-0 overflow-hidden bg-background'
      >
        {pane}
      </aside>
      <div className='absolute top-0 right-2.5 z-20 flex h-[calc(var(--app-tab-bar-height)-1px)] items-center gap-1'>
        <KeybindTooltip binding={keybinds.details}>
          <Button
            variant='ghost-text'
            size='icon'
            className='aria-expanded:text-muted-foreground aria-expanded:not-disabled:hover:text-foreground'
            aria-label={`${open ? 'Close' : 'Open'} ${name}`}
            aria-expanded={open}
            aria-keyshortcuts='Meta+Alt+B'
            {...pressProps(toggle)}
          >
            <SidebarLeftIcon className='rotate-180' />
          </Button>
        </KeybindTooltip>
      </div>
      {open && !full && (
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a focusable splitter; <hr> can't take focus or pointer handlers
          role='separator'
          aria-label={`Resize ${name}`}
          aria-orientation='vertical'
          aria-valuemin={minWidth}
          aria-valuemax={Math.round(max)}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          className='details-resize'
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

// The pane's tabs: the tab bar (with the sidebar toggle while it's full width, and expand
// while it isn't narrow) over the tab panels.
export function DetailsPane({
  label,
  tab,
  onTabChange,
  full,
  narrow,
  expanded,
  onExpandedChange,
  tabs,
  children,
}: {
  label: string
  tab: string
  onTabChange: (tab: string) => void
  full: boolean
  narrow: boolean
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  tabs: ReactNode
  children: ReactNode
}) {
  const expandLabel = expanded ? 'Restore split view' : `Expand ${label.toLowerCase()}`
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (typeof value === 'string') onTabChange(value)
      }}
      className='details-pane h-full min-w-0 gap-0'
    >
      <header className='flex h-(--app-tab-bar-height) shrink-0 justify-end border-b border-border pr-[42px]'>
        {full && (
          <div className='flex shrink-0 items-center pl-(--page-header-inset)'>
            <PageSidebarTrigger />
          </div>
        )}
        <div className='no-scrollbar scroll-fade-x min-w-0 flex-1 overflow-x-auto overflow-y-hidden'>
          {tabs}
        </div>
        {!narrow && (
          <div className='ml-1 flex shrink-0 items-center'>
            <Button
              variant='ghost-text'
              size='icon'
              aria-label={expandLabel}
              title={expandLabel}
              {...pressProps(() => onExpandedChange(!expanded))}
            >
              {expanded ? <ArrowShrink02Icon /> : <ArrowExpand01Icon />}
            </Button>
          </div>
        )}
      </header>
      <div className='min-h-0 flex-1 overflow-hidden'>
        <div className='details-tab-track min-w-(--details-pane-width)'>{children}</div>
      </div>
    </Tabs>
  )
}

// One tab's panel, kept mounted while it's hidden.
export function DetailsTabPanel({
  value,
  tab,
  children,
}: {
  value: string
  tab: string
  children?: ReactNode
}) {
  return (
    <TabsContent
      keepMounted
      value={value}
      inert={tab !== value}
      aria-hidden={tab !== value}
      className='details-tab-panel'
    >
      {children}
    </TabsContent>
  )
}

// The Chat tab's panel, where the chat moves while the pane is full width.
export function DetailsChatPanel({
  tab,
  slotRef,
}: {
  tab: string
  slotRef: (slot: HTMLDivElement | null) => void
}) {
  return (
    <DetailsTabPanel value='chat' tab={tab}>
      <div ref={slotRef} className='flex h-full min-h-0 min-w-0 flex-col' />
    </DetailsTabPanel>
  )
}

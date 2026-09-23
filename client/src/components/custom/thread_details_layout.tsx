import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pressProps } from '@/lib/press'
import { ArrowsInSimpleIcon, ArrowsOutSimpleIcon, SidebarSimpleIcon } from '@phosphor-icons/react'
import { DiffIcon, GitPullRequestIcon, ListUnorderedIcon } from '@primer/octicons-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

import './thread_details_layout.css'

const tabs = [
  { id: 'changes', label: 'Changes', Icon: DiffIcon, blurb: "This thread's file changes" },
  { id: 'overview', label: 'Overview', Icon: ListUnorderedIcon, blurb: 'A summary of this thread' },
  { id: 'pr', label: 'PR', Icon: GitPullRequestIcon, blurb: "This thread's pull request" },
]

const minWidth = 320
const narrowWidth = 760

export function ThreadDetailsLayout({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number; next: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [available, setAvailable] = useState(0)
  const [preferredWidth, setPreferredWidth] = useState<number>()
  const [expanded, setExpanded] = useState(false)
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
        <div className='flex h-full min-w-[320px] flex-col'>{children}</div>
      </div>
      <aside
        aria-label='Thread details'
        inert={!open}
        aria-hidden={!open || undefined}
        className='relative min-h-0 min-w-0 overflow-hidden bg-background'
      >
        <Tabs defaultValue='changes' className='details-pane h-full min-w-0 gap-0'>
          <header className='flex h-(--app-tab-bar-height) shrink-0 border-b border-border pr-[74px]'>
            <TabsList
              variant='line'
              aria-label='Thread details views'
              className='h-full! gap-1.5 p-1 px-2'
            >
              {tabs.map(({ id, label, Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className='details-header-tab h-auto rounded-sm px-1 py-1 text-xs'
                >
                  <Icon className='size-3' />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </header>
          {tabs.map(({ id, blurb }) => (
            <TabsContent
              key={id}
              value={id}
              className='flex min-h-0 flex-col items-center justify-center gap-1 p-4 text-center'
            >
              <p className='text-sm'>Coming soon</p>
              <p className='text-xs text-muted-foreground'>{blurb} will show here.</p>
            </TabsContent>
          ))}
        </Tabs>
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

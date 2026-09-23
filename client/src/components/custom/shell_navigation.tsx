import type { RouterHistory } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

const indexOf = (history: RouterHistory) => history.location.state.__TSR_index

function useHistoryPosition() {
  const { history } = useRouter()
  const [position, setPosition] = useState(() => ({
    index: indexOf(history),
    furthest: indexOf(history),
  }))
  useEffect(
    () =>
      history.subscribe(({ action }) =>
        setPosition((previous) => {
          const index = indexOf(history)
          return {
            index,
            furthest: action.type === 'PUSH' ? index : Math.max(previous.furthest, index),
          }
        })
      ),
    [history]
  )
  return {
    canGoBack: position.index > 0,
    canGoForward: position.index < position.furthest,
    back: () => history.back(),
    forward: () => history.forward(),
  }
}

function useNavigationWidth() {
  const { open, isMobile } = useSidebar()
  const expanded = open && !isMobile
  return { expanded, width: expanded ? 'calc(var(--sidebar-width) - 6px)' : '30px' }
}

export function ShellNavigation() {
  const { isMobile, open, openMobile } = useSidebar()
  const { expanded, width } = useNavigationWidth()
  const { canGoBack, canGoForward, back, forward } = useHistoryPosition()
  return (
    <nav
      aria-label='Thread navigation'
      data-slot='shell-navigation'
      data-sidebar-open={expanded}
      className='app-shell-navigation absolute left-1.5 top-1.5 z-30 flex shrink-0 items-center justify-between gap-1 transition-[width] duration-(--motion-sidebar-open-duration) data-[sidebar-open=false]:duration-(--motion-sidebar-close-duration) ease-(--motion-sidebar-ease) motion-reduce:transition-none'
      style={{ width }}
    >
      <SidebarTrigger
        variant='ghost'
        tone='muted'
        size='icon'
        className='hover:bg-sidebar-accent'
        aria-label={(isMobile ? openMobile : open) ? 'Collapse sidebar' : 'Expand sidebar'}
      />
      <div className={expanded ? 'flex shrink-0 items-center gap-1' : 'hidden'}>
        <Button
          variant='ghost'
          tone='muted'
          size='icon'
          className='hover:bg-sidebar-accent'
          aria-label='Go back'
          disabled={!canGoBack}
          onClick={back}
        >
          <CaretLeftIcon weight='regular' />
        </Button>
        <Button
          variant='ghost'
          tone='muted'
          size='icon'
          className='hover:bg-sidebar-accent'
          aria-label='Go forward'
          disabled={!canGoForward}
          onClick={forward}
        >
          <CaretRightIcon weight='regular' />
        </Button>
      </div>
    </nav>
  )
}

export function ShellNavigationSpace() {
  const { expanded, width } = useNavigationWidth()
  return (
    <div
      aria-hidden='true'
      data-sidebar-open={expanded}
      className='shrink-0 transition-[width] duration-(--motion-sidebar-open-duration) data-[sidebar-open=false]:duration-(--motion-sidebar-close-duration) ease-(--motion-sidebar-ease) motion-reduce:transition-none'
      style={{ width }}
    />
  )
}

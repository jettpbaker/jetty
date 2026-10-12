import { useSidebar } from '@/components/ui/sidebar'

// The shell navigation's toggle glides onto this slot as the sidebar closes. The standalone
// header keeps its row either way, so the page under it doesn't jump when the sidebar toggles.
export function PageSidebarTrigger({ standalone = false }: { standalone?: boolean }) {
  const { open, isMobile, openMobile } = useSidebar()
  const closed = !(isMobile ? openMobile : open)
  const slot = closed ? <div aria-hidden='true' className='-ml-1.5 size-7 shrink-0' /> : null
  if (!standalone) return slot
  return (
    <header className='flex h-(--app-tab-bar-height) shrink-0 items-center pl-(--page-header-inset)'>
      {slot}
    </header>
  )
}

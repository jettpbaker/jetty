import { useSidebar } from '@/components/ui/sidebar'

// The shell navigation's toggle glides onto this slot as the sidebar closes.
export function PageSidebarTrigger({ standalone = false }: { standalone?: boolean }) {
  const { open, isMobile, openMobile } = useSidebar()
  if (isMobile ? openMobile : open) return null
  const slot = <div aria-hidden='true' className='-ml-1.5 size-7 shrink-0' />
  return standalone ? (
    <header className='flex h-(--app-tab-bar-height) shrink-0 items-center pl-(--page-header-inset)'>
      {slot}
    </header>
  ) : (
    slot
  )
}

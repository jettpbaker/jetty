import { useSidebar } from '@/components/ui/sidebar'
import { createContext, useContext } from 'react'

export const PageSidebarTriggerContext = createContext(false)

export function PageSidebarTrigger({ standalone = false }: { standalone?: boolean }) {
  const enabled = useContext(PageSidebarTriggerContext)
  return enabled ? <CollapsedSidebarSlot standalone={standalone} /> : null
}

// The shell navigation's toggle glides onto this slot as the sidebar closes.
function CollapsedSidebarSlot({ standalone }: { standalone: boolean }) {
  const { open, isMobile, openMobile } = useSidebar()
  if (isMobile ? openMobile : open) return null
  const slot = <div aria-hidden='true' className='size-7 shrink-0' />
  return standalone ? (
    <header className='flex h-(--app-tab-bar-height) shrink-0 items-center pl-(--page-header-inset)'>
      {slot}
    </header>
  ) : (
    slot
  )
}

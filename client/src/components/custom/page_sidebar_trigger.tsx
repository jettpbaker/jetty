import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { createContext, useContext } from 'react'

// Standalone component previews do not have shell navigation.
export const PageSidebarTriggerContext = createContext(false)

export function PageSidebarTrigger({ standalone = false }: { standalone?: boolean }) {
  const enabled = useContext(PageSidebarTriggerContext)
  return enabled ? <CollapsedSidebarTrigger standalone={standalone} /> : null
}

function CollapsedSidebarTrigger({ standalone }: { standalone: boolean }) {
  const { open, isMobile, openMobile } = useSidebar()
  if (isMobile ? openMobile : open) return null
  const button = (
    <SidebarTrigger
      variant='ghost'
      tone='muted'
      size='icon'
      className='shrink-0 pointer-events-auto'
      aria-label='Expand sidebar'
      title='Expand sidebar (⌘B)'
    />
  )
  return standalone ? (
    <header className='flex h-(--app-tab-bar-height) shrink-0 items-center px-1.5'>{button}</header>
  ) : (
    button
  )
}

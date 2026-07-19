import { TabBar } from '@/components/tab-bar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IconContext } from '@phosphor-icons/react'
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

const iconDefaults = {
  color: 'currentColor',
  size: '1em',
  weight: 'bold' as const,
  mirrored: false,
}

function RootLayout() {
  return (
    <IconContext.Provider value={iconDefaults}>
      <TooltipProvider>
        <div className='flex h-svh flex-col'>
          <TabBar />
          <main className='min-h-0 flex-1 overflow-hidden'>
            <Outlet />
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </IconContext.Provider>
  )
}

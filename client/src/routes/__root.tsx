import { TabBar } from '@/components/tab-bar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <TooltipProvider>
      <div className='flex h-svh flex-col'>
        <TabBar />
        <main className='min-h-0 flex-1 overflow-hidden'>
          <Outlet />
        </main>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}

import { AppShell } from '@/components/custom/app_shell'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StateProvider } from '@/state'
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({ component: Root })

function Root() {
  return (
    <StateProvider>
      <TooltipProvider>
        <AppShell>
          <Outlet />
        </AppShell>
        <Toaster position='top-center' />
      </TooltipProvider>
    </StateProvider>
  )
}

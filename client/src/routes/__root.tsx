import { AppShell } from '@/components/custom/app_shell'
import { DiffWorkerPoolProvider } from '@/components/custom/diff_worker_pool'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StateProvider } from '@/state'
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({ component: Root })

function Root() {
  return (
    <StateProvider>
      <TooltipProvider>
        <DiffWorkerPoolProvider>
          <AppShell>
            <Outlet />
          </AppShell>
        </DiffWorkerPoolProvider>
        <Toaster position='top-center' />
      </TooltipProvider>
    </StateProvider>
  )
}

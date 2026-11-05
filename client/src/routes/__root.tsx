import { AppShell } from '@/components/custom/app_shell'
import { DiffWorkerPoolProvider } from '@/components/custom/diff_worker_pool'
import { KeybindProvider } from '@/components/custom/keybinds'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StateProvider } from '@/state'
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({ component: Root })

function Root() {
  return (
    <StateProvider>
      <TooltipProvider>
        <KeybindProvider>
          <DiffWorkerPoolProvider>
            <AppShell>
              <Outlet />
            </AppShell>
          </DiffWorkerPoolProvider>
        </KeybindProvider>
      </TooltipProvider>
    </StateProvider>
  )
}

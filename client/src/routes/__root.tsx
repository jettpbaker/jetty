import { AppShell } from '@/components/custom/app_shell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StateProvider } from '@/state'
import { IconContext, type IconProps } from '@phosphor-icons/react'
import { createRootRoute, Outlet } from '@tanstack/react-router'

const icons: IconProps = { weight: 'bold' }

export const Route = createRootRoute({ component: Root })

function Root() {
  return (
    <StateProvider>
      <IconContext.Provider value={icons}>
        <TooltipProvider>
          <AppShell>
            <Outlet />
          </AppShell>
        </TooltipProvider>
      </IconContext.Provider>
    </StateProvider>
  )
}

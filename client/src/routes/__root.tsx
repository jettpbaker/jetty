import { StateProvider } from '@/state'
import { IconContext, type IconProps } from '@phosphor-icons/react'
import { createRootRoute, Outlet } from '@tanstack/react-router'

const icons: IconProps = { weight: 'bold' }

export const Route = createRootRoute({ component: Root })

function Root() {
  return (
    <StateProvider>
      <IconContext.Provider value={icons}>
        <Outlet />
      </IconContext.Provider>
    </StateProvider>
  )
}

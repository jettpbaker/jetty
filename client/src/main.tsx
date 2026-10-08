import '@/perf/boot'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { loadAccent } from './lib/accent'
import { followAccent, hydrateAppearance } from './lib/appearance'
import { applyPointerCursors } from './lib/pointer-cursors'
import { refreshScrollFadesWhenOverflowEnds } from './lib/scroll-fade'
import { applyTheme, followTheme } from './lib/theme'
import { routeTree } from './routeTree.gen'
import './index.css'
import './accent.css'
import './theme-transition.css'

applyTheme()
followTheme()
applyPointerCursors()
document.documentElement.dataset.accent = loadAccent()
void hydrateAppearance()
followAccent()
refreshScrollFadesWhenOverflowEnds()

const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)

// Every page's code, once the app is idle: a first visit never waits on its chunk.
function preloadRoutes() {
  for (const route of Object.values(router.routesById))
    void router.loadRouteChunk(route)?.catch(() => {})
}

window.addEventListener(
  'load',
  () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(preloadRoutes)
    else setTimeout(preloadRoutes, 0)
  },
  { once: true }
)

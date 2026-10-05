import '@/perf/boot'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { loadAccent } from './lib/accent'
import { hydrateAppearance } from './lib/appearance'
import { refreshScrollFadesWhenOverflowEnds } from './lib/scroll-fade'
import { applyTheme, followSystemTheme } from './lib/theme'
import { routeTree } from './routeTree.gen'
import './index.css'
import './accent.css'
import './theme-transition.css'

applyTheme()
followSystemTheme()
document.documentElement.dataset.accent = loadAccent()
void hydrateAppearance()
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

function preloadMainRoutes() {
  for (const id of [
    '/threads/$threadId',
    '/pull-requests/',
    '/pull-requests/$owner/$repo/$number',
    '/settings',
  ] as const) {
    void router.loadRouteChunk(router.routesById[id])?.catch(() => {})
  }
}

window.addEventListener(
  'load',
  () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(preloadMainRoutes)
    else setTimeout(preloadMainRoutes, 0)
  },
  { once: true }
)

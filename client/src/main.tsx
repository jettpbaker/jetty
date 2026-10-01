import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { loadAccent } from './lib/accent'
import { hydrateAppearance } from './lib/appearance'
import { refreshScrollFadesWhenOverflowEnds } from './lib/scroll-fade'
import { applyTheme } from './lib/theme'
import { routeTree } from './routeTree.gen'
import './index.css'
import './accent.css'
import './theme-transition.css'

applyTheme()
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

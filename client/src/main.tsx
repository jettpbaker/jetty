import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { bind as bindCuelume } from 'cuelume'

import { chromeStore, draftsStore, tabsStore, timelineStore } from './app-state'
import { syncTheme } from './lib/theme'
import { routeTree } from './routeTree.gen'
import { hydrate } from './state/persist'
import './styles.css'

syncTheme()
// delegated listeners: every data-cuelume-* attribute app-wide, present or future
bindCuelume()

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- TanStack Router requires interface augmentation
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

// Blocks first paint (ms-scale); store guards make races with the socket safe.
await hydrate(chromeStore, tabsStore, timelineStore, draftsStore)

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)

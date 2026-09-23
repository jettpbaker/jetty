import type { ReactNode } from 'react'

import { RegistryProvider } from '@effect/atom-react'

function nextFrame(task: () => void) {
  const id = requestAnimationFrame(task)
  return () => cancelAnimationFrame(id)
}

export function StateProvider({ children }: { children: ReactNode }) {
  return <RegistryProvider scheduleTask={nextFrame}>{children}</RegistryProvider>
}

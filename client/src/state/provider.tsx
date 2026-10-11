import type { ComponentProps, ReactNode } from 'react'

import { RegistryProvider } from '@effect/atom-react'

function nextFrame(task: () => void) {
  const id = requestAnimationFrame(task)
  return () => cancelAnimationFrame(id)
}

export function StateProvider({
  children,
  initialValues,
}: {
  children: ReactNode
  initialValues?: ComponentProps<typeof RegistryProvider>['initialValues']
}) {
  return (
    <RegistryProvider scheduleTask={nextFrame} initialValues={initialValues}>
      {children}
    </RegistryProvider>
  )
}

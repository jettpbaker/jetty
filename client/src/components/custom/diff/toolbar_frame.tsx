import type { ReactNode } from 'react'

export function DiffToolbarFrame({ children }: { children: ReactNode }) {
  return (
    <div className='flex h-10 shrink-0 items-center gap-2 border-b border-border px-4'>
      {children}
    </div>
  )
}

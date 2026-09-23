import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { ProviderGlyph } from './provider_glyph'

// Where a message or request came from: the other agent's provider glyph and its name.
export function SourceLabel({
  provider,
  className,
  children,
}: {
  provider?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)}
    >
      {provider && <ProviderGlyph provider={provider} className='size-3 shrink-0' />}
      {children}
    </span>
  )
}

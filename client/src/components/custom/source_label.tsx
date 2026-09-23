import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { useChrome } from '@/state'
import { useNavigate } from '@tanstack/react-router'

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

export type MessageSource = { threadId: string; title: string }

// A message another thread sent: that thread's glyph and title, linking to it.
export function ThreadSourceLabel({
  from,
  className,
}: {
  from: MessageSource
  className?: string
}) {
  const navigate = useNavigate()
  const provider = useChrome()?.threads.find((thread) => thread.id === from.threadId)?.provider
  return (
    <SourceLabel provider={provider} className={className}>
      <button
        type='button'
        onClick={() => navigate({ to: '/threads/$threadId', params: { threadId: from.threadId } })}
        className='truncate text-foreground/90 hover:text-foreground hover:underline'
      >
        {from.title}
      </button>
    </SourceLabel>
  )
}

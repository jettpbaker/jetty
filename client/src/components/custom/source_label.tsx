import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { useBot, useThreadMeta } from '@/state'
import { useNavigate } from '@tanstack/react-router'

import { BotAvatar, botColorStyle, botTextClass } from './bot_avatar'
import { inlineLinkClass } from './entity_link'
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
  const meta = useThreadMeta(from.threadId)
  const bot = useBot(from.threadId)
  if (bot)
    return (
      <button
        type='button'
        onClick={() => navigate({ to: '/bots/$botId', params: { botId: bot.id } })}
        style={botColorStyle(bot.color)}
        className={cn('flex items-center gap-1.5 text-xs font-medium', botTextClass, className)}
      >
        <BotAvatar bot={bot} size={14} unread={false} />
        {bot.name}
      </button>
    )
  // No meta: the sender was deleted, so its title stays as plain text.
  if (!meta)
    return (
      <SourceLabel className={className}>
        <span className='truncate text-foreground'>{from.title}</span>
      </SourceLabel>
    )
  return (
    <SourceLabel provider={meta.provider} className={className}>
      <button
        type='button'
        onClick={() => navigate({ to: '/threads/$threadId', params: { threadId: from.threadId } })}
        className={cn(inlineLinkClass, 'truncate')}
      >
        {from.title}
      </button>
    </SourceLabel>
  )
}

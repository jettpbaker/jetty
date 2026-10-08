import type { Bot } from '@jetty/shared/wire'

import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'
import { botFace } from '@jetty/shared/bots'

import { BotAvatar } from './bot_avatar'

export function BotRow({
  bot,
  selected,
  onOpen,
}: {
  bot: Bot
  selected: boolean
  onOpen: () => void
}) {
  const face = botFace(bot)
  const label = `${bot.name}, ${face === 'thinking' ? 'typing' : face === 'waiting' ? 'needs you' : face}${bot.unread && !selected ? ', unread' : ''}`
  const className = cn(
    'flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-sm [--jb-ring:var(--sidebar)]',
    selected && 'bg-sidebar-accent [--jb-ring:var(--sidebar-accent)]'
  )
  return (
    <button
      type='button'
      aria-label={label}
      aria-current={selected || undefined}
      {...pressProps(onOpen)}
      className={cn(
        className,
        'outline-none hover:bg-sidebar-accent hover:[--jb-ring:var(--sidebar-accent)] focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      <BotAvatar bot={bot} size={24} unread={bot.unread && !selected} />
      <span className='min-w-0 flex-1 truncate'>{bot.name}</span>
    </button>
  )
}

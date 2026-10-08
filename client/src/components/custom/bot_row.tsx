import type { Keybind } from '@/components/custom/keybinds'
import type { Bot } from '@jetty/shared/wire'

import { HeldKeybind } from '@/components/custom/keybinds'
import { cn } from '@/lib/utils'
import { botFace } from '@jetty/shared/bots'
import { useEffect, useRef } from 'react'

import { BotAvatar } from './bot_avatar'

export function BotRow({
  bot,
  selected,
  shortcut,
  onOpen,
}: {
  bot: Bot
  selected: boolean
  shortcut?: Keybind
  onOpen: () => void
}) {
  const rowRef = useRef<HTMLButtonElement>(null)
  // A bot opened from elsewhere (just created, the palette) shows in the list, however long it is.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const face = botFace(bot)
  const label = `${bot.name}, ${face === 'thinking' ? 'typing' : face === 'waiting' ? 'needs you' : face}${bot.unread && !selected ? ', unread' : ''}`
  const className = cn(
    'flex h-9 w-full min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2 text-left text-sm [--jb-ring:var(--sidebar)]',
    selected && 'bg-sidebar-accent [--jb-ring:var(--sidebar-accent)]'
  )
  return (
    <button
      ref={rowRef}
      type='button'
      aria-label={label}
      aria-current={selected || undefined}
      // The list scrolls, so a press might be a scroll: open on click, like the thread rows.
      onClick={onOpen}
      className={cn(
        className,
        'outline-none hover:bg-sidebar-accent hover:[--jb-ring:var(--sidebar-accent)] focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      <BotAvatar bot={bot} size={24} unread={bot.unread && !selected} />
      <span className='min-w-0 flex-1 truncate'>{bot.name}</span>
      <HeldKeybind binding={shortcut}>
        <span />
      </HeldKeybind>
    </button>
  )
}

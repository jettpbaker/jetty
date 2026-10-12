import type { Keybind } from '@/components/custom/keybinds'
import type { Bot } from '@jetty/shared/wire'

import { HeldKeybind } from '@/components/custom/keybinds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { botFace } from '@jetty/shared/bots'
import { useEffect, useRef } from 'react'

import { BotAvatar } from './bot_avatar'
import { ChevronRightSmallIcon } from './central_icons'

export function BotRow({
  bot,
  selected,
  shortcut,
  onOpen,
  expanded,
  onToggle,
}: {
  bot: Bot
  selected: boolean
  shortcut?: Keybind
  onOpen: () => void
  expanded: boolean
  onToggle: () => void
}) {
  const rowRef = useRef<HTMLButtonElement>(null)
  // A bot opened from elsewhere (just created, the palette) shows in the list, however long it is.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const face = botFace(bot)
  const label = `${bot.name}, ${face === 'waiting' ? 'needs you' : face}${bot.unread && !selected ? ', unread' : ''}`
  const className = cn(
    'flex h-9 w-full min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2 text-left text-sm [--jb-ring:var(--sidebar)]',
    selected && 'bg-sidebar-accent [--jb-ring:var(--sidebar-accent)]'
  )
  return (
    <div className='group/bot-row relative rounded-md hover:bg-sidebar-accent hover:[--jb-ring:var(--sidebar-accent)]'>
      <button
        ref={rowRef}
        type='button'
        aria-label={label}
        aria-current={selected || undefined}
        onClick={onOpen}
        className={cn(className, 'outline-none focus-visible:ring-2 focus-visible:ring-ring')}
      >
        <BotAvatar
          bot={bot}
          size={24}
          unread={bot.unread && !selected}
          className='group-hover/bot-row:invisible group-has-focus-visible/bot-row:invisible'
        />
        <span className='min-w-0 flex-1 truncate'>{bot.name}</span>
        <HeldKeybind binding={shortcut}>
          <span />
        </HeldKeybind>
      </button>
      <Button
        variant='ghost-text'
        size='icon-xs'
        className='absolute top-1.5 left-2 opacity-0 group-hover/bot-row:opacity-100 group-has-focus-visible/bot-row:opacity-100'
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} ${bot.name}'s threads`}
        onClick={onToggle}
      >
        <ChevronRightSmallIcon
          className={cn(
            'transition-transform duration-(--motion-control-duration) ease-(--motion-control-ease) motion-reduce:transition-none',
            expanded && 'rotate-90'
          )}
        />
      </Button>
    </div>
  )
}

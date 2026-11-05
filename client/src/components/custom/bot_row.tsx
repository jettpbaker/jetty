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
  // Absent while the bot has no threads to show.
  onToggle?: () => void
}) {
  const rowRef = useRef<HTMLButtonElement>(null)
  // A bot opened from elsewhere (just created, the palette) shows in the list, however long it is.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const face = botFace(bot)
  const label = `${bot.name}, ${face === 'waiting' ? 'needs you' : face}${bot.unread && !selected ? ', unread' : ''}`
  const className = cn(
    'flex h-8 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-left text-sm [--jb-ring:var(--sidebar)]',
    onToggle && 'pr-9',
    selected && 'bg-sidebar-accent [--jb-ring:var(--sidebar-accent)]'
  )
  return (
    <div className='relative rounded-sm hover:bg-sidebar-accent hover:[--jb-ring:var(--sidebar-accent)]'>
      <button
        ref={rowRef}
        type='button'
        aria-label={label}
        aria-current={selected || undefined}
        onClick={onOpen}
        className={cn(className, 'outline-none focus-visible:ring-2 focus-visible:ring-ring')}
      >
        <HeldKeybind binding={shortcut}>
          <BotAvatar bot={bot} size={16} unread={bot.unread && !selected} />
        </HeldKeybind>
        <span className='min-w-0 flex-1 truncate'>{bot.name}</span>
      </button>
      {onToggle && (
        <Button
          variant='ghost-text'
          size='icon-xs'
          className='absolute top-1 right-2.5'
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
      )}
    </div>
  )
}

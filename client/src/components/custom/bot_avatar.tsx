import type { Bot, BotColor } from '@jetty/shared/wire'

import { botFace } from '@jetty/shared/bots'
import { useEffect, useState, type CSSProperties } from 'react'

import { ErrorBot } from './bot_error_states'
import { JettyBot } from './jetty_bot'
import { botColors, deepBotColors } from './jetty_bot_shapes'

// Done's hops, twinkles and wink, before the face settles back to idle.
const DONE_MS = 1200

// Done plays once when a turn ends with a reply Jett hasn't seen, then settles back to idle; the
// unread dot alone keeps saying unseen.
function useDoneOnce({ id, unread }: Pick<Bot, 'id' | 'unread'>) {
  const [prior, setPrior] = useState({ id, unread })
  const [done, setDone] = useState(false)
  if (id !== prior.id || unread !== prior.unread) {
    setPrior({ id, unread })
    // A face that moves to another bot (switching chats) starts over.
    if (id !== prior.id) setDone(false)
    else if (unread) setDone(true)
  }
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), DONE_MS)
    return () => clearTimeout(timer)
  }, [done])
  return done
}

// A bot's face as its state shows it.
export function BotAvatar({
  bot,
  size,
  unread,
  className,
}: {
  bot: Pick<Bot, 'id' | 'shape' | 'color' | 'activity' | 'needsYou' | 'failed' | 'unread'>
  size: number
  unread?: boolean
  className?: string
}) {
  const resting = botFace(bot)
  const done = useDoneOnce(bot)
  const face = resting === 'idle' && done ? 'done' : resting
  if (face === 'error')
    return <ErrorBot shape={bot.shape} color={bot.color} size={size} className={className} />
  return (
    <JettyBot
      shape={bot.shape}
      color={bot.color}
      state={face}
      size={size}
      unread={unread ?? bot.unread}
      className={className}
    />
  )
}

// The bot's colour as --bot (dark) and --bot-deep (light), for botTextClass and the chat's accent.
export function botColorStyle(color: BotColor) {
  return { '--bot': botColors[color], '--bot-deep': deepBotColors[color] } as CSSProperties
}

// Text in the bot's colour: its deep ink in light, as its face is drawn.
export const botTextClass = 'text-(--bot-deep) dark:text-(--bot)'

// The bot's colour plays the accent inside: bubbles and buttons that fill with primary take it,
// deep with light text in light. Links keep the app's accent, so this never wraps them.
export const botAccentClass =
  '[--primary-foreground:oklch(0.99_0_0)] [--primary:var(--bot-deep)] dark:[--primary-foreground:oklch(0.205_0_0)] dark:[--primary:var(--bot)]'
